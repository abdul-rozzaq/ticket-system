import { Global, Module } from '@nestjs/common';
import { ClientGroupsController } from '../client-groups/client-groups.controller';
import { ClientGroupsService } from '../client-groups/client-groups.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Global()
@Module({
  controllers: [TicketsController, ClientGroupsController],
  providers: [TicketsService, ClientGroupsService],
  exports: [TicketsService, ClientGroupsService],
})
export class TicketsModule {}
