import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { createUserSchema, resetPasswordSchema, updateUserSchema } from '@tp/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/guards';
import { ZodPipe } from '../../common/http';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(
    @Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>,
    @CurrentUser() actor: User,
  ) {
    return this.users.create(body, actor.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: z.infer<typeof updateUserSchema>,
    @CurrentUser() actor: User,
  ) {
    return this.users.update(id, body, actor.id);
  }

  @HttpCode(204)
  @Post(':id/reset-password')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
    @CurrentUser() actor: User,
  ) {
    await this.users.resetPassword(id, body.newPassword, actor.id);
  }

  @HttpCode(200)
  @Post(':id/telegram-code')
  telegramCode(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    return this.users.createTelegramCode(id, actor.id);
  }
}
