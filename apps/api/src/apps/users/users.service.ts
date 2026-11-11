import { HttpStatus, Injectable, OnApplicationBootstrap, Logger, Inject } from '@nestjs/common';
import { Prisma } from '../../common/prisma-client';
import type { createUserSchema, updateUserSchema } from '@tp/shared';
import type { z } from 'zod';
import { APP_ENV, Env } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { AuthService, publicUser } from '../auth/auth.service';
import { CryptoService } from '../../common/crypto.service';
import { AuditService } from '../../common/audit.service';
import { DomainEvents } from '../../common/domain-events';
import { AppError } from '../../common/http';

const LINK_CODE_TTL_MS = 24 * 3600_000;

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Users');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /** Seeds the first admin from env when the user table is empty. */
  async onApplicationBootstrap() {
    if (await this.prisma.user.count()) return;
    const password = this.env.SEED_ADMIN_PASSWORD;
    if (!password) {
      this.logger.warn('No users exist and SEED_ADMIN_PASSWORD is not set: nobody can log in.');
      return;
    }
    await this.prisma.user.create({
      data: {
        username: this.env.SEED_ADMIN_USERNAME.toLowerCase(),
        displayName: 'Admin',
        role: 'ADMIN',
        passwordHash: await this.auth.hashPassword(password),
        mustChangePassword: true,
      },
    });
    this.logger.log(
      `Seeded admin "${this.env.SEED_ADMIN_USERNAME}" (password change required at first login).`,
    );
  }

  async list() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(publicUser);
  }

  async create(input: z.infer<typeof createUserSchema>, actorId: string) {
    try {
      const user = await this.prisma.user.create({
        data: {
          username: input.username,
          displayName: input.displayName,
          role: input.role,
          passwordHash: await this.auth.hashPassword(input.password),
          mustChangePassword: true,
          workingHours: input.workingHours as Prisma.InputJsonValue | undefined,
        },
      });
      await this.audit.log({
        actorId,
        action: 'user.create',
        entity: 'User',
        entityId: user.id,
        meta: { role: user.role },
      });
      return publicUser(user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError(HttpStatus.CONFLICT, 'USERNAME_TAKEN', 'Bu login band');
      }
      throw e;
    }
  }

  async update(id: string, input: z.infer<typeof updateUserSchema>, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Foydalanuvchi topilmadi');
    // Guard against locking everybody out.
    if (id === actorId && (input.isActive === false || (input.role && input.role !== 'ADMIN'))) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'SELF_LOCKOUT',
        "O'zingizni o'chirib yoki huquqingizni kamaytirib bo'lmaydi",
      );
    }
    const { workingHours, ...rest } = input;
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(workingHours ? { workingHours: workingHours as Prisma.InputJsonValue } : {}) },
    });
    if (input.isActive === false || (input.role && input.role !== existing.role))
      await this.auth.revokeAllForUser(id);
    if (input.isActive === false && existing.isActive) this.events.emit('user.deactivated', { userId: id });
    await this.audit.log({
      actorId,
      action: 'user.update',
      entity: 'User',
      entityId: id,
      meta: { fields: Object.keys(input) },
    });
    return publicUser(user);
  }

  async resetPassword(id: string, newPassword: string, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Foydalanuvchi topilmadi');
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await this.auth.hashPassword(newPassword), mustChangePassword: true },
    });
    await this.auth.revokeAllForUser(id);
    await this.audit.log({ actorId, action: 'user.reset_password', entity: 'User', entityId: id });
  }

  /** One-time code for linking the user's Telegram account via `/start <code>` in the internal bot. Shown once. */
  async createTelegramCode(id: string, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Foydalanuvchi topilmadi');
    const code = this.crypto.randomCode(8);
    const expires = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.prisma.user.update({
      where: { id },
      data: { telegramLinkHash: this.crypto.sha256(code), telegramLinkExpiry: expires },
    });
    await this.audit.log({ actorId, action: 'user.telegram_code', entity: 'User', entityId: id });
    return { code, expiresAt: expires };
  }

  /** Called by the bot (service token): consumes a link code and binds the Telegram user id. */
  async linkTelegram(code: string, telegramUserId: bigint) {
    const user = await this.prisma.user.findFirst({
      where: {
        telegramLinkHash: this.crypto.sha256(code.trim().toUpperCase()),
        telegramLinkExpiry: { gt: new Date() },
        isActive: true,
      },
    });
    if (!user) return null;
    try {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { telegramUserId, telegramLinkHash: null, telegramLinkExpiry: null },
      });
      await this.audit.log({
        actorId: user.id,
        action: 'user.telegram_linked',
        entity: 'User',
        entityId: user.id,
      });
      return publicUser(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError(
          HttpStatus.CONFLICT,
          'TELEGRAM_TAKEN',
          "Bu Telegram hisobi boshqa xodimga bog'langan",
        );
      }
      throw e;
    }
  }
}
