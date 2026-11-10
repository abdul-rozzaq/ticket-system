import { Module } from '@nestjs/common';
import { IntakeModule } from '../intake/intake.module';
import { FoldersService } from './folders.service';
import { FoldersController, FunnelController } from './funnel.controllers';
import { FunnelService } from './funnel.service';

@Module({
  imports: [IntakeModule],
  controllers: [FunnelController, FoldersController],
  providers: [FunnelService, FoldersService],
  exports: [FunnelService, FoldersService],
})
export class FunnelModule {}
