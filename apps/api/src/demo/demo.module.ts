import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DemoSeedService } from './demo-seed.service';

@Module({ imports: [AuthModule], providers: [DemoSeedService], exports: [DemoSeedService] })
export class DemoModule {}
