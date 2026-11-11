import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { User } from '../../common/prisma-client';
import { changePasswordSchema, loginSchema, refreshSchema } from '@tp/shared';
import { z } from 'zod';
import { AuthService, publicUser } from './auth.service';
import { AllowMustChange, clientCtx, CurrentUser, Public } from './guards';
import { ZodPipe } from '../../common/http';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: () => Number(process.env.LOGIN_RATE_LIMIT ?? 20), ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request) {
    return this.auth.login(body.username, body.password, clientCtx(req));
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, clientCtx(req));
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    await this.auth.logout(body.refreshToken);
  }

  @ApiBearerAuth()
  @AllowMustChange()
  @Get('me')
  me(@CurrentUser() user: User) {
    return publicUser(user);
  }

  @ApiBearerAuth()
  @AllowMustChange()
  @HttpCode(200)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: User,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(user.id, body.currentPassword, body.newPassword, clientCtx(req));
  }
}
