import { Module } from '@nestjs/common';
import { KbModule } from '../kb/kb.module';
import {
  AuditController,
  SlaPoliciesController,
  SlaPoliciesService,
  StatsController,
} from './admin.controllers';
import { StatsService } from './stats.service';

@Module({
  imports: [KbModule],
  controllers: [AuditController, SlaPoliciesController, StatsController],
  providers: [SlaPoliciesService, StatsService],
  exports: [StatsService],
})
export class AdminModule {}
