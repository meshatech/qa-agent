import { Inject, Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { QaRunResult } from '../../domain/models/run.model.js';

@Injectable()
export class ReportRunUseCase {
  constructor(@Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort) {}

  async execute(runsDir: string, runId: string | undefined, format: 'md' | 'json'): Promise<string | QaRunResult> {
    const dir = await this.repo.findRunDir(runsDir, runId);
    if (format === 'json') return this.repo.readJson<QaRunResult>(dir, 'run.json');
    return readFile(join(dir, 'execution-report.md'), 'utf8');
  }
}
