import { Module } from '@nestjs/common';
import { IntakeModule } from '../intake/intake.module';
import { UsersModule } from '../users/users.module';
import { ServiceTokenGuard } from '../intake/service-token.guard';
import { BotConfigService, BotOutboxService, CardService } from './bot-core.service';
import { BotNotifier } from './bot-notifier.service';
import { BotAdminController, InternalBotController } from './bot.controllers';
import { BotService } from './bot.service';
import { RemindersService } from './reminders.service';

@Module({
  imports: [IntakeModule, UsersModule],
  controllers: [InternalBotController, BotAdminController],
  providers: [
    BotConfigService,
    BotOutboxService,
    CardService,
    BotService,
    BotNotifier,
    RemindersService,
    ServiceTokenGuard,
  ],
  exports: [BotService, RemindersService, BotNotifier, BotOutboxService, BotConfigService],
})
export class BotModule {}
