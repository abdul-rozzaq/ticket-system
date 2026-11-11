import { DemoModule } from './apps/demo/demo.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './common/config.module';
import { PrismaModule } from './common/prisma.service';
import { CommonModule } from './common/common.module';
import { AuthModule } from './apps/auth/auth.module';
import { UsersModule } from './apps/users/users.module';
import { EventsModule } from './common/domain-events';
import { SettingsModule } from './common/settings.service';
import { TicketsModule } from './apps/tickets/tickets.module';
import { TemplatesModule } from './apps/tickets/templates.module';
import { RealtimeModule } from './common/realtime.gateway';
import { AiModule } from './apps/ai/ai.controller';
import { IntakeModule } from './apps/intake/intake.module';
import { BotModule } from './apps/bot/bot.module';
import { FunnelModule } from './apps/funnel/funnel.module';
import { KbModule } from './apps/kb/kb.module';
import { AdminModule } from './apps/admin/admin.module';
import { HealthController } from './common/health.controller';

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
    AdminModule,
    DemoModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
