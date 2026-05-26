import { Inject, Injectable } from '@nestjs/common';

import type { ClickUpReaderPort } from '../ports/clickup-reader.port.js';
import type { DemandContextWriterPort } from '../ports/demand-context-writer.port.js';
import {
  DemandContextSchema,
  type DemandContext,
} from '../../domain/schemas/demand-context.schema.js';
import { SanitizerService } from './sanitizer.service.js';

export interface DemandContextPersistResult {
  path: string;
  demand: DemandContext;
}

@Injectable()
export class DemandContextPersistenceService {
  constructor(
    @Inject('DemandContextWriterPort')
    private readonly writer: DemandContextWriterPort,
    @Inject('ClickUpReaderPort') private readonly clickUpReader: ClickUpReaderPort,
    @Inject(SanitizerService) private readonly sanitizer: SanitizerService,
  ) {}

  async persistDemandContext(
    runDir: string,
    demand: DemandContext,
    knownSecrets: string[] = [],
  ): Promise<DemandContextPersistResult> {
    const validated = DemandContextSchema.parse(demand);
    const sanitized = this.sanitizer.sanitizeForOutput(validated, knownSecrets);
    const path = await this.writer.write(runDir, sanitized);
    return { path, demand: DemandContextSchema.parse(sanitized) };
  }

  async persistFromClickUpTask(
    runDir: string,
    token: string,
    options?: { configTaskId?: string; configTeamId?: string },
  ): Promise<DemandContextPersistResult> {
    const result = await this.clickUpReader.readConfiguredTask(
      token,
      options?.configTaskId,
      options?.configTeamId,
    );
    return this.persistDemandContext(runDir, result.demand, [token]);
  }
}
