import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { MemoryCandidate } from '../../domain/schemas/memory-candidate.schema.js';

export interface RunHistoryEntry {
  runId: string;
  timestamp: string;
  status: QaRunResult['status'];
  totalSteps: number;
  totalScenarios: number;
  candidateCount: number;
  candidates: Array<Pick<MemoryCandidate, 'id' | 'type' | 'title' | 'confidence'>>;
}

export interface RunRepositoryPort {
  createRunDir(config: RunConfig): Promise<string>;
  ensureDir(runDir: string, path: string): Promise<void>;
  writeJson(runDir: string, name: string, data: unknown): Promise<void>;
  writeFile(runDir: string, name: string, data: string | Buffer): Promise<void>;
  writeReport(runDir: string, result: QaRunResult, config: RunConfig, runId: string): Promise<void>;
  findRunDir(runsDir: string, runId?: string): Promise<string>;
  readJson<T>(runDir: string, name: string): Promise<T>;
  exists(runDir: string, relativePath: string): Promise<boolean>;
  listFiles(runDir: string, relativePath: string): Promise<string[]>;
  appendRunHistory(runDir: string, entry: RunHistoryEntry): Promise<void>;
  deleteFile(runDir: string, name: string): Promise<void>;
}
