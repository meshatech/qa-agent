import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

export interface RunRepositoryPort {
  createRunDir(config: RunConfig): Promise<string>;
  ensureDir(runDir: string, path: string): Promise<void>;
  writeJson(runDir: string, name: string, data: unknown): Promise<void>;
  writeFile(runDir: string, name: string, data: string | Buffer): Promise<void>;
  writeReport(runDir: string, result: QaRunResult, config: RunConfig, runId: string): Promise<void>;
  findRunDir(runsDir: string, runId?: string): Promise<string>;
  readJson<T>(runDir: string, name: string): Promise<T>;
}
