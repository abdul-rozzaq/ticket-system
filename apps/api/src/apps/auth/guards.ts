import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { t, type Role } from '@tp/shared';
import type { User } from '../../common/prisma-client';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma.service';
import { AppError } from '../../common/http';

export const PUBLIC_KEY = 'tp:public';
export const ROLES_KEY = 'tp:roles';
export const ALLOW_MUST_CHANGE_KEY = 'tp:allowMustChange';

/** Route needs no authentication. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Route requires one of the given roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Route stays reachable while the account still has to change its password. */
export const AllowMustChange = () => SetMetadata(ALLOW_MUST_CHANGE_KEY, true);

export type AuthedRequest = Request & { user: User; correlationId?: string };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});

export const clientCtx = (req: Request) => ({
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent'] ?? null,
});

/**
 * Global guard: verifies the bearer token, then loads the user from the DB on every request so that
 * deactivation, role changes and forced password changes take effect immediately (small team: the extra query is cheap).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const unauthorized = () =>
      new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', t('auth.invalidCredentials'));
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = await this.auth.verifyAccess(token);
    } catch {
      throw unauthorized();
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw unauthorized();
    req.user = user;

    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_KEY, targets)
    ) {
      throw new AppError(HttpStatus.FORBIDDEN, 'MUST_CHANGE_PASSWORD', t('auth.mustChangePassword'));
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', t('auth.forbidden'));
    }
    return true;
  }
}
