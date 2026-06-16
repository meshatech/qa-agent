import { Module } from '@nestjs/common';
import { CliService } from './cli.service.js';
import { InterfacesModule } from '../interfaces/interfaces.module.js';

@Module({
  imports: [InterfacesModule],
  providers: [CliService],
  exports: [CliService],
})
export class CliModule {}
