import { Injectable } from '@nestjs/common';
import type { QaAction } from '../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';

export interface TaskWorkingMemory {
  scenarioId: string;
  taskId: string;
  objective: string;
  expected: string;
  state: 'PLANNING' | 'ACTING' | 'RECOVERING' | 'BLOCKED' | 'DONE';
  observedStates: string[];
  actionsTried: Array<{ type: string; targetElementId?: string; reason?: string; outcome: string }>;
  hypotheses: string[];
  rejectedDecisions: Array<{ reason: string; nextRecommendation?: string; ts: string }>;
  blockers: string[];
  nextRecommendation?: string;
}

@Injectable()
export class TaskMemoryService {
  private readonly items = new Map<string, TaskWorkingMemory>();

  reset(): void {
    this.items.clear();
  }

  ensure(input: Pick<TaskWorkingMemory, 'scenarioId' | 'taskId' | 'objective' | 'expected'>): TaskWorkingMemory {
    const key = this.key(input.scenarioId, input.taskId);
    const existing = this.items.get(key);
    if (existing) return existing;
    const created: TaskWorkingMemory = { ...input, state: 'PLANNING', observedStates: [], actionsTried: [], hypotheses: [], rejectedDecisions: [], blockers: [] };
    this.items.set(key, created);
    return created;
  }

  observe(scenarioId: string, taskId: string, obs: ScreenObservation): void {
    const item = this.items.get(this.key(scenarioId, taskId));
    if (!item) return;
    this.push(item.observedStates, `${obs.url} :: ${obs.visibleTexts.slice(0, 6).join(' | ')}`, 6);
  }

  action(scenarioId: string, taskId: string, action: QaAction, outcome: string): void {
    const item = this.items.get(this.key(scenarioId, taskId));
    if (!item) return;
    item.state = outcome.startsWith('REJECTED') ? 'PLANNING' : outcome === 'RECOVERING' ? 'RECOVERING' : 'ACTING';
    item.actionsTried.push({
      type: action.type,
      targetElementId: 'targetElementId' in action ? action.targetElementId : undefined,
      reason: 'reason' in action ? action.reason : undefined,
      outcome,
    });
    item.actionsTried = item.actionsTried.slice(-8);
  }

  hypothesis(scenarioId: string, taskId: string, text: string): void {
    const item = this.items.get(this.key(scenarioId, taskId));
    if (item) this.push(item.hypotheses, text, 6);
  }

  reject(scenarioId: string, taskId: string, reason: string, nextRecommendation?: string): void {
    const item = this.items.get(this.key(scenarioId, taskId));
    if (!item) return;
    item.state = 'PLANNING';
    item.nextRecommendation = nextRecommendation;
    item.rejectedDecisions.push({ reason, nextRecommendation, ts: new Date().toISOString() });
    item.rejectedDecisions = item.rejectedDecisions.slice(-6);
    this.push(item.hypotheses, `Rejected decision: ${reason}`, 6);
  }

  block(scenarioId: string, taskId: string, reason: string): void {
    const item = this.items.get(this.key(scenarioId, taskId));
    if (!item) return;
    item.state = 'BLOCKED';
    this.push(item.blockers, reason, 6);
  }

  done(scenarioId: string, taskId: string): void {
    const item = this.items.get(this.key(scenarioId, taskId));
    if (item) item.state = 'DONE';
  }

  context(scenarioId: string, taskId: string): string {
    const item = this.items.get(this.key(scenarioId, taskId));
    if (!item) return '';
    return [
      'Working memory:',
      `- Objective: ${item.objective}`,
      `- Expected: ${item.expected}`,
      `- State: ${item.state}`,
      item.nextRecommendation ? `- Next recommended step: ${item.nextRecommendation}` : undefined,
      ...item.observedStates.slice(-3).map((s) => `- Observed: ${s}`),
      ...item.actionsTried.slice(-4).map((a) => `- Tried: ${a.type}${a.targetElementId ? ` ${a.targetElementId}` : ''} -> ${a.outcome}${a.reason ? ` (${a.reason})` : ''}`),
      ...item.rejectedDecisions.slice(-3).map((r) => `- Rejected: ${r.reason}${r.nextRecommendation ? `; next: ${r.nextRecommendation}` : ''}`),
      ...item.hypotheses.slice(-3).map((h) => `- Hypothesis: ${h}`),
      ...item.blockers.slice(-3).map((b) => `- Blocker: ${b}`),
    ].filter(Boolean).join('\n');
  }

  all(): TaskWorkingMemory[] {
    return [...this.items.values()];
  }

  private key(scenarioId: string, taskId: string): string {
    return `${scenarioId}:${taskId}`;
  }

  private push(items: string[], value: string, limit: number): void {
    if (!value.trim() || items.at(-1) === value) return;
    items.push(value);
    items.splice(0, Math.max(0, items.length - limit));
  }
}
