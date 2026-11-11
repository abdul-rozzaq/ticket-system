import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.controller';
import { DraftService } from './draft.service';
import { KbGrowthService } from './kb-growth.service';
import { KbSearchService } from './kb-search.service';
import { DraftController, KbController } from './kb.controllers';
import { KbService } from './kb.service';

@Module({
  imports: [AiModule],
  controllers: [KbController, DraftController],
  providers: [KbService, KbSearchService, DraftService, KbGrowthService],
  exports: [KbService, KbSearchService, DraftService, KbGrowthService],
})
export class KbModule {}
