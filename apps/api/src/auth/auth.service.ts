import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { t } from '@tp/shared';
import type { Role, User } from '@prisma/client';
import { APP_ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/http';

export interface AccessPayload {
  sub: string;
  role: Role;
  /** must-change-password flag at issue time (the guard re-checks the DB, this is informational for clients). */
  mcp: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ClientCtx {
  ip?: string | null;
  userAgent?: string | null;
}

export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  onDuty: u.onDuty,
  available: u.available,
  workingHours: u.workingHours,
  telegramLinked: u.telegramUserId != null,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

@Injectable()
export class AuthService {
  /** Verified against when the username does not exist, so response time does not reveal valid usernames. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  private async assertNotLocked(username: string, ip?: string | null) {
    const since = new Date(Date.now() - this.env.LOCKOUT_WINDOW_MINUTES * 60_000);
    const failuresForUser = await this.prisma.loginAttempt.count({
      where: { username, success: false, createdAt: { gte: since } },
    });
    // A successful login resets the user counter: only failures after the latest success count.
    const lastOk = await this.prisma.loginAttempt.findFirst({
      where: { username, success: true, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    const failures = lastOk
      ? await this.prisma.loginAttempt.count({
          where: { username, success: false, createdAt: { gt: lastOk.createdAt } },
        })
      : failuresForUser;
    const failuresForIp = ip
      ? await this.prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } })
      : 0;
    if (failures >= this.env.LOCKOUT_MAX_FAILURES || failuresForIp >= this.env.LOCKOUT_MAX_FAILURES * 4) {
      await this.audit.log({ action: 'auth.locked', meta: { username }, ip });
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'LOCKED', t('auth.locked'));
    }
  }

  async login(
    username: string,
    password: string,
    ctx: ClientCtx,
  ): Promise<{ user: ReturnType<typeof publicUser> } & TokenPair> {
    await this.assertNotLocked(username, ctx.ip);
    const user = await this.prisma.user.findUnique({ where: { username } });
    this.dummyHash ??= argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });
    const ok = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), password).catch(() => false);
    if (!user || !ok) {
      await this.prisma.loginAttempt.create({ data: { username, ip: ctx.ip, success: false } });
      await this.audit.log({ action: 'auth.login_failed', meta: { username }, ip: ctx.ip });
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', t('auth.invalidCredentials'));
    }
    if (!user.isActive) {
      await this.prisma.loginAttempt.create({ data: { username, ip: ctx.ip, success: false } });
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INACTIVE', t('auth.inactive'));
    }
    await this.prisma.loginAttempt.create({ data: { username, ip: ctx.ip, success: true } });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: ctx.ip,
    });
    const tokens = await this.issue(user, randomUUID(), ctx);
    return { user: publicUser(user), ...tokens };
  }

  private async issue(user: User, familyId: string, ctx: ClientCtx): Promise<TokenPair> {
    const payload: AccessPayload = { sub: user.id, role: user.role, mcp: user.mustChangePassword };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.env.ACCESS_TTL_SECONDS });
    const refreshToken = this.crypto.randomToken(32);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: this.crypto.sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000),
        userAgent: ctx.userAgent?.slice(0, 200),
        ip: ctx.ip,
      },
    });
    return { accessToken, refreshToken, expiresIn: this.env.ACCESS_TTL_SECONDS };
  }

  /** Rotating refresh: each token is single-use. Presenting an already-used token revokes the whole family. */
  async refresh(refreshToken: string, ctx: ClientCtx): Promise<TokenPair> {
    const hash = this.crypto.sha256(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });
    const invalid = () =>
      new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_REFRESH', t('auth.invalidCredentials'));
    if (!row) throw invalid();
    if (row.revokedAt) {
      // Reuse of a rotated/revoked token: assume theft, kill the family.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log({
        actorId: row.userId,
        action: 'auth.refresh_reuse',
        meta: { familyId: row.familyId },
        ip: ctx.ip,
      });
      throw invalid();
    }
    if (row.expiresAt < new Date() || !row.user.isActive) throw invalid();

    // Claim the token atomically: only one concurrent request can flip revokedAt from null.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid();
    const next = await this.issue(row.user, row.familyId, ctx);
    const newRow = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.crypto.sha256(next.refreshToken) },
    });
    if (newRow)
      await this.prisma.refreshToken.update({ where: { id: row.id }, data: { replacedById: newRow.id } });
    return next;
  }

  async logout(refreshToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.crypto.sha256(refreshToken) },
    });
    if (row) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log({ actorId: row.userId, action: 'auth.logout' });
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, current: string, next: string, ctx: ClientCtx): Promise<TokenPair> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, current).catch(() => false))) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', t('auth.invalidCredentials'));
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(next), mustChangePassword: false },
    });
    await this.revokeAllForUser(userId); // other sessions must log in again
    await this.audit.log({
      actorId: userId,
      action: 'auth.password_changed',
      entity: 'User',
      entityId: userId,
      ip: ctx.ip,
    });
    return this.issue(updated, randomUUID(), ctx);
  }

  verifyAccess(token: string): Promise<AccessPayload> {
    return this.jwt.verifyAsync<AccessPayload>(token);
  }
}
