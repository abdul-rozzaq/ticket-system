import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.service';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/domain-events';
import { SettingsModule } from './settings/settings.service';
import { TicketsModule } from './tickets/tickets.module';
import { TemplatesModule } from './templates/templates.module';
import { RealtimeModule } from './realtime/realtime.gateway';
import { AiModule } from './ai/ai.controller';
import { IntakeModule } from './intake/intake.module';
import { BotModule } from './bot/bot.module';
import { FunnelModule } from './funnel/funnel.module';
import { KbModule } from './kb/kb.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CommonModule,
    EventsModule,
    SettingsModule,
    // Coarse global limiter; login/refresh have tighter per-route limits plus DB-backed lockout.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    AuthModule,
    UsersModule,
    TicketsModule,
    TemplatesModule,
    RealtimeModule,
    AiModule,
    IntakeModule,
    BotModule,
    FunnelModule,
    KbModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
