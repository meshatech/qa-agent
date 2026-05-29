import { Inject, Injectable } from '@nestjs/common';
import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { realpath as realpathCallback } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, join, resolve, sep } from 'node:path';
import type { RunRepositoryPort, RunHistoryEntry } from '../../application/ports/run-repository.port.js';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { RunDirectoryManager } from './run-directory.manager.js';
import { ReportRenderer } from './report-renderer.js';

const realpathNative = promisify(realpathCallback.native);

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

  async exists(runDir: string, relativePath: string): Promise<boolean> {
    try {
      const target = await this.resolveInsideRunDir(runDir, relativePath);
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(runDir: string, relativePath: string): Promise<string[]> {
    try {
      const target = await this.resolveInsideRunDir(runDir, relativePath);
      const s = await stat(target);
      if (!s.isDirectory()) return [];
      const entries = await readdir(target, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async appendRunHistory(runDir: string, entry: RunHistoryEntry): Promise<void> {
    const target = join(runDir, 'run-history.jsonl');
    await mkdir(dirname(target), { recursive: true }).catch(() => undefined);
    const line = JSON.stringify(entry);
    await appendFile(target, `${line}\n`);
  }

  async deleteFile(runDir: string, name: string): Promise<void> {
    try {
      const target = await this.resolveInsideRunDir(runDir, name);
      await rm(target);
    } catch {
      // ignore if file does not exist
    }
  }

  async renameFile(runDir: string, oldName: string, newName: string): Promise<void> {
    const oldPath = await this.resolveInsideRunDir(runDir, oldName);
    const newPath = await this.resolveInsideRunDir(runDir, newName);
    await rename(oldPath, newPath);
  }

  private async resolveInsideRunDir(runDir: string, relativePath: string): Promise<string> {
    const resolved = await realpathNative(resolve(runDir, relativePath));
    const normalizedRunDir = await realpathNative(resolve(runDir));
    if (resolved === normalizedRunDir) return resolved;
    const prefix = normalizedRunDir.endsWith(sep) ? normalizedRunDir : `${normalizedRunDir}${sep}`;
    if (!resolved.startsWith(prefix)) {
      throw new Error(`Path traversal blocked: ${relativePath}`);
    }
    return resolved;
  }
}
