import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { AuditService } from '../audit/audit.service';

@Global()
@Module({ providers: [CryptoService, AuditService], exports: [CryptoService, AuditService] })
export class CommonModule {}
