import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PlanCachePort } from '../../application/ports/plan-cache.port.js';
import type { PlannedExecutionPlan } from '../../application/services/execution-plan-planner.service.js';

interface CacheEntry {
  value: PlannedExecutionPlan;
  expiresAt: number;
}

export class FilePlanCacheAdapter implements PlanCachePort {
  private readonly cachePath: string;

  constructor(cachePath = '.agent-qa/plan-cache.json') {
    this.cachePath = cachePath;
  }

  async get(key: string): Promise<PlannedExecutionPlan | undefined> {
    const data = await this.readCache();
    const entry = data[key];
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      delete data[key];
      await this.writeCache(data);
      return undefined;
    }
    return { ...entry.value, plan: entry.value.plan ? { ...entry.value.plan } : undefined };
  }

  async set(key: string, value: PlannedExecutionPlan, ttlMs = 3600000): Promise<void> {
    const data = await this.readCache();
    data[key] = { value, expiresAt: Date.now() + ttlMs };
    await this.writeCache(data);
  }

  private async readCache(): Promise<Record<string, CacheEntry>> {
    try {
      const raw = await readFile(this.cachePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private async writeCache(data: Record<string, CacheEntry>): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true }).catch(() => undefined);
    await writeFile(this.cachePath, JSON.stringify(data, null, 2));
  }
}
