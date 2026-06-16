import { Module } from '@nestjs/common';
import { ApplicationModule } from '../application/application.module.js';
import { AgentController } from './cli/agent.controller.js';

@Module({ imports: [ApplicationModule], providers: [AgentController], exports: [AgentController, ApplicationModule] })
export class InterfacesModule {}
