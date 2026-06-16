import { Module } from '@nestjs/common';
import { InterfacesModule } from './interfaces/interfaces.module.js';
import { ApiModule } from './api/api.module.js';
import { CliModule } from './cli/cli.module.js';

@Module({ imports: [InterfacesModule, ApiModule, CliModule] })
export class AppModule {}
