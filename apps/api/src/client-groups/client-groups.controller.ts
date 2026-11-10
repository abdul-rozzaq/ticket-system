import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { clientGroupSchema } from '@tp/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/guards';
import { AppError, ZodPipe } from '../common/http';
import { ClientGroupsService } from './client-groups.service';

@ApiTags('client-groups')
@ApiBearerAuth()
@Controller('client-groups')
export class ClientGroupsController {
  constructor(private readonly groups: ClientGroupsService) {}

  @Get()
  list(@Query('confirmed') confirmed?: string, @Query('active') active?: string) {
    return this.groups.list({
      confirmed: confirmed === undefined ? undefined : confirmed === 'true',
      active: active === undefined ? undefined : active === 'true',
    });
  }

  /** The extension asks "which client group is this Telegram Web chat?" (any id format). */
  @Get('by-chat/:chatId')
  async byChat(@Param('chatId') chatId: string) {
    const g = await this.groups.findByChatId(decodeURIComponent(chatId));
    if (!g) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Bu chat mijoz guruhi sifatida topilmadi');
    return g;
  }

  @Roles('ADMIN')
  @Post()
  create(
    @Body(new ZodPipe(clientGroupSchema)) body: z.infer<typeof clientGroupSchema>,
    @CurrentUser() actor: User,
  ) {
    return this.groups.create(body, actor.id);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(clientGroupSchema.partial())) body: Partial<z.infer<typeof clientGroupSchema>>,
    @CurrentUser() actor: User,
  ) {
    return this.groups.update(id, body, actor.id);
  }
}
