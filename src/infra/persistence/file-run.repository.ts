import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RunRepositoryPort } from '../../application/ports/run-repository.port.js';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { RunDirectoryManager } from './run-directory.manager.js';
import { ReportRenderer } from './report-renderer.js';

@Injectable()
export class FileRunRepository implements RunRepositoryPort {
  constructor(
    @Inject(RunDirectoryManager) private readonly dirs: RunDirectoryManager,
    @Inject(ReportRenderer) private readonly renderer: ReportRenderer,
  ) {}

  async createRunDir(config: RunConfig): Promise<string> {
    return this.dirs.create(config);
  }

  async ensureDir(runDir: string, path: string): Promise<void> {
    await mkdir(join(runDir, path), { recursive: true });
  }

  async writeJson(runDir: string, name: string, data: unknown): Promise<void> {
    const target = join(runDir, name);
    await mkdir(dirname(target), { recursive: true }).catch(() => undefined);
    await writeFile(target, JSON.stringify(data, null, 2));
  }

  async writeFile(runDir: string, name: string, data: string | Buffer): Promise<void> {
    const target = join(runDir, name);
    await mkdir(dirname(target), { recursive: true }).catch(() => undefined);
    await writeFile(target, data);
  }

  async writeReport(runDir: string, result: QaRunResult, config: RunConfig, runId: string): Promise<void> {
    const md = this.renderer.renderExecutionReport(result, config, runId);
    await writeFile(join(runDir, 'execution-report.md'), md);
  }

  async findRunDir(runsDir: string, runId?: string): Promise<string> {
    if (runId) return join(runsDir, runId);
    const dirs = await readdir(runsDir, { withFileTypes: true });
    const names = dirs.filter((d) => d.isDirectory()).map((d) => d.name).sort();
    if (!names.length) throw new Error(`No runs found in ${runsDir}`);
    return join(runsDir, names.at(-1)!);
  }

  async readJson<T>(runDir: string, name: string): Promise<T> {
    return JSON.parse(await readFile(join(runDir, name), 'utf8')) as T;
  }
}
