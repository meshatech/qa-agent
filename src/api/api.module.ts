import { Module } from '@nestjs/common';
import { ApiController } from './api.controller.js';
import { ApiService } from './api.service.js';
import { InterfacesModule } from '../interfaces/interfaces.module.js';
import { CliModule } from '../cli/cli.module.js';

@Module({
  imports: [InterfacesModule, CliModule],
  controllers: [ApiController],
  providers: [ApiService],
  exports: [ApiService],
})
export class ApiModule {}
