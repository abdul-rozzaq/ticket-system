import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { APP_ENV, Env } from '../config/env';
import { CryptoService } from '../common/crypto.service';
import { AppError } from '../common/http';

/** Service-to-service auth for the userbot / bot: `x-service-token` must equal SERVICE_TOKEN (constant-time compare). */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    private readonly crypto: CryptoService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.env.SERVICE_TOKEN)
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_TOKEN_UNSET',
        'SERVICE_TOKEN is not configured',
      );
    const header = ctx.switchToHttp().getRequest<Request>().headers['x-service-token'];
    if (typeof header !== 'string' || !this.crypto.safeEqual(header, this.env.SERVICE_TOKEN)) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'BAD_SERVICE_TOKEN', 'Unauthorized');
    }
    return true;
  }
}
