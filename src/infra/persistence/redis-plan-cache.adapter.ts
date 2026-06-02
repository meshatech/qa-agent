import type { PlanCachePort } from '../../application/ports/plan-cache.port.js';
import type { PlannedExecutionPlan } from '../../application/services/execution-plan-planner.service.js';

export class RedisPlanCacheAdapter implements PlanCachePort {
  private readonly prefix: string;
  private readonly ttlSeconds: number;

  constructor(
    private readonly redisUrl: string,
    options?: { prefix?: string; ttlSeconds?: number },
  ) {
    this.prefix = options?.prefix ?? 'qa-agent:plan:';
    this.ttlSeconds = Math.floor((options?.ttlSeconds ?? 3600));
  }

  async get(key: string): Promise<PlannedExecutionPlan | undefined> {
    try {
      const redis = await import('redis').catch(() => undefined);
      if (!redis) return undefined;
      const client = (redis as unknown as { createClient: (opts: unknown) => { connect: () => Promise<void>; get: (k: string) => Promise<string | null>; disconnect: () => Promise<void> } }).createClient({ url: this.redisUrl });
      await client.connect();
      const raw = await client.get(this.prefix + key);
      await client.disconnect();
      if (!raw) return undefined;
      return JSON.parse(raw) as PlannedExecutionPlan;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: PlannedExecutionPlan, ttlMs?: number): Promise<void> {
    try {
      const redis = await import('redis').catch(() => undefined);
      if (!redis) return;
      const client = (redis as unknown as { createClient: (opts: unknown) => { connect: () => Promise<void>; setEx: (k: string, ttl: number, v: string) => Promise<string>; disconnect: () => Promise<void> } }).createClient({ url: this.redisUrl });
      await client.connect();
      const ttl = ttlMs ? Math.floor(ttlMs / 1000) : this.ttlSeconds;
      await client.setEx(this.prefix + key, ttl, JSON.stringify(value));
      await client.disconnect();
    } catch {
      // Silently fail — caller can fallback to factory
    }
  }
}
