import { Inject, Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';

@Injectable()
export class InspectRunUseCase {
  constructor(@Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort) {}

  async execute(runsDir: string, runId?: string): Promise<QaRunResult> {
    const dir = await this.repo.findRunDir(runsDir, runId);
    return this.repo.readJson<QaRunResult>(dir, 'run.json');
  }
}
