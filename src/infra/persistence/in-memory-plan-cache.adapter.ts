import type { PlanCachePort } from '../../application/ports/plan-cache.port.js';
import type { PlannedExecutionPlan } from '../../application/services/execution-plan-planner.service.js';

interface CacheEntry {
  value: PlannedExecutionPlan;
  expiresAt: number;
}

export class InMemoryPlanCacheAdapter implements PlanCachePort {
  private readonly store = new Map<string, CacheEntry>();

  async get(key: string): Promise<PlannedExecutionPlan | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return { ...entry.value, plan: entry.value.plan ? { ...entry.value.plan } : undefined };
  }

  async set(key: string, value: PlannedExecutionPlan, ttlMs = 3600000): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
