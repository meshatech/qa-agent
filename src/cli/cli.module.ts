import { Module } from '@nestjs/common';
import { CliService } from './cli.service.js';
import { CliCommand } from './cli.command.js';
import { InterfacesModule } from '../interfaces/interfaces.module.js';

@Module({
  imports: [InterfacesModule],
  providers: [CliService, CliCommand],
  exports: [CliService, CliCommand],
})
export class CliModule {}
