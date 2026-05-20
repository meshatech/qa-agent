import { Module } from '@nestjs/common';
import { InterfacesModule } from './interfaces/interfaces.module.js';

@Module({ imports: [InterfacesModule] })
export class AppModule {}
