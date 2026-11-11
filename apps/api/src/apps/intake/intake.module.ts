import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.controller';
import { AttributionService } from './attribution.service';
import { AutoAssignService } from './auto-assign.service';
import {
  InternalUserbotController,
  IntakeStaffController,
  UserbotAdminController,
} from './intake.controllers';
import { IntakeService } from './intake.service';
import { OutboxService } from './outbox.service';
import { ServiceTokenGuard } from './service-token.guard';

@Module({
  imports: [AiModule],
  controllers: [InternalUserbotController, UserbotAdminController, IntakeStaffController],
  providers: [IntakeService, AttributionService, OutboxService, AutoAssignService, ServiceTokenGuard],
  exports: [IntakeService, AttributionService, OutboxService, AutoAssignService],
})
export class IntakeModule {}
