import { appendFile, access, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { SanitizerService } from './sanitizer.service.js';

export interface RunHistoryEntry {
  runId: string;
  ts: string;
  status: 'passed' | 'failed' | 'blocked' | string;
  demandId?: string;
  summary?: string;
  [key: string]: unknown;
}

@Injectable()
export class RunHistoryService {
  constructor(private readonly sanitizer: SanitizerService) {}

  resolveHistoryPath(projectPath: string): string {
    return join(projectPath, '.agent-qa', 'run-history.jsonl');
  }

  async ensureFile(projectPath: string): Promise<string> {
    const historyPath = this.resolveHistoryPath(projectPath);
    await mkdir(dirname(historyPath), { recursive: true });
    try {
      await access(historyPath);
    } catch {
      await appendFile(historyPath, '# run-history.jsonl — one JSON object per line.\n', 'utf8');
    }
    return historyPath;
  }

  async append(projectPath: string, entry: RunHistoryEntry): Promise<void> {
    const historyPath = await this.ensureFile(projectPath);
    const sanitized = this.sanitizer.sanitize(entry) as RunHistoryEntry;
    await appendFile(historyPath, `${JSON.stringify(sanitized)}\n`, 'utf8');
  }

  async readLines(projectPath: string): Promise<RunHistoryEntry[]> {
    const historyPath = this.resolveHistoryPath(projectPath);
    const raw = await readFile(historyPath, 'utf8').catch(() => '');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => JSON.parse(line) as RunHistoryEntry);
  }
}
