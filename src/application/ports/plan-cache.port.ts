import type { PlannedExecutionPlan } from '../services/execution-plan-planner.service.js';

export interface PlanCachePort {
  get(key: string): Promise<PlannedExecutionPlan | undefined>;
  set(key: string, value: PlannedExecutionPlan, ttlMs?: number): Promise<void>;
}
