import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { patchOf } from '@tp/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/guards';
import { ZodPipe } from '../common/http';

const CATEGORIES = ['salomlashuv', 'AmoCRM', 'Bitrix', 'PBX', 'yopish', 'boshqa'] as const;
const templateSchema = z.object({
  category: z.string().min(1).max(40).default('boshqa'),
  title: z.string().min(1).max(120),
  /** Variables: {mijoz_nomi} {tizim} {xodim}. */
  bodyUz: z.string().min(1).max(4000),
  bodyRu: z.string().max(4000).nullable().optional(),
  keywords: z.array(z.string().max(40)).max(30).default([]),
  isActive: z.boolean().default(true),
});

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(category?: string, includeInactive = false) {
    return this.prisma.template.findMany({
      where: { category, isActive: includeInactive ? undefined : true },
      orderBy: [{ usageCount: 'desc' }, { title: 'asc' }],
    });
  }
  create(data: z.infer<typeof templateSchema>) {
    return this.prisma.template.create({ data });
  }
  update(id: string, data: Partial<z.infer<typeof templateSchema>>) {
    return this.prisma.template.update({ where: { id }, data });
  }
  remove(id: string) {
    return this.prisma.template.delete({ where: { id } });
  }
  /** Atomic counter increment (no read-modify-write race). */
  use(id: string) {
    return this.prisma.template.update({ where: { id }, data: { usageCount: { increment: 1 } } });
  }
}

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Get()
  list(@Query('category') category?: string, @Query('all') all?: string) {
    return this.svc.list(category, all === 'true');
  }

  @Roles('ADMIN')
  @Post()
  create(@Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.svc.create(body);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(patchOf(templateSchema))) body: Partial<z.infer<typeof templateSchema>>,
  ) {
    return this.svc.update(id, body);
  }

  @Roles('ADMIN')
  @HttpCode(204)
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(id);
  }

  /** Staff report that a template was inserted into a chat (usage counter). */
  @HttpCode(204)
  @Post(':id/use')
  async use(@Param('id', ParseUUIDPipe) id: string) {
    await this.svc.use(id);
  }
}

export const TEMPLATE_CATEGORIES = CATEGORIES;

@Module({ controllers: [TemplatesController], providers: [TemplatesService], exports: [TemplatesService] })
export class TemplatesModule {}
