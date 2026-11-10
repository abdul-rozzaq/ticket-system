import { Controller, Get, Body, Put, Injectable, Module, Global } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { DEFAULT_SETTINGS } from '@tp/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/guards';
import { ZodPipe } from '../common/http';

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany();
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async get<K extends SettingKey>(key: K): Promise<(typeof DEFAULT_SETTINGS)[K]> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row ? row.value : DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K];
  }

  async set(key: string, value: unknown): Promise<void> {
    const v = value as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }
}

const updateSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

@ApiTags('settings')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  all() {
    return this.settings.getAll();
  }

  /** Only known keys are accepted, with the same primitive type as their default. */
  @Put()
  async update(@Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    for (const [k, v] of Object.entries(body)) {
      const def = (DEFAULT_SETTINGS as Record<string, unknown>)[k];
      if (def === undefined || typeof def !== typeof v) continue;
      await this.settings.set(k, v);
    }
    return this.settings.getAll();
  }
}

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
