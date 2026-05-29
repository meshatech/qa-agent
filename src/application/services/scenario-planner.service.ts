import { Inject, Injectable } from '@nestjs/common';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import type { QaScenario, QaTask, ScenarioIntent } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';
import { ExpectedOutcomeResolverService } from './expected-outcome-resolver.service.js';

@Injectable()
export class ScenarioPlannerService {
  constructor(
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
    @Inject(ExpectedOutcomeResolverService) private readonly outcomeResolver: ExpectedOutcomeResolverService,
  ) {}

  async plan(config: RunConfig): Promise<QaScenario[]> {
    const scenarios = await this.buildScenarios(config);
    const normalized = await this.normalizeScenarioTasks(scenarios, config);
    const withAuth = this.applyAuthPolicy(normalized, config);
    return this.enforcePlanPolicy(withAuth, config);
  }

  /**
   * Resolves scenarios from the decision provider or falls back to generated ones.
   */
  private async buildScenarios(config: RunConfig): Promise<QaScenario[]> {
    let scenarios: QaScenario[] | undefined;
    try {
      scenarios = await this.decision.plan?.(config);
    } catch {
      scenarios = undefined;
    }
    if (!scenarios?.length) {
      scenarios = await this.fallback(config);
    }
    return scenarios;
  }

  /**
   * Canonicalizes each task, resolves expectedOutcome when missing,
   * topologically sorts dependencies, then applies auth awareness.
   */
  private async normalizeScenarioTasks(scenarios: QaScenario[], config: RunConfig): Promise<QaScenario[]> {
    const resolved = await Promise.all(
      scenarios.map(async (scenario) => {
        const canonicalTasks = scenario.tasks.map((task) => this.canonicalTask(task));
        const outcomes = await this.resolveOutcomes(config, canonicalTasks);
        return {
          ...scenario,
          tasks: canonicalTasks.map((task, index) => ({
            ...task,
            expectedOutcome: task.expectedOutcome ?? outcomes[index],
          })),
        };
      }),
    );
    return resolved.map((scenario) => ({
      ...scenario,
      tasks: this.authAwareTasks(this.topoSort(scenario.tasks), config),
    }));
  }

  private async resolveOutcomes(config: RunConfig, tasks: QaTask[]): Promise<ExpectedOutcome[]> {
    if (typeof this.outcomeResolver.resolveMany === 'function') {
      return this.outcomeResolver.resolveMany(config, tasks);
    }
    return Promise.all(tasks.map((task) => this.outcomeResolver.resolve(config, task)));
  }

  /**
   * Wraps scenarios in an authenticated plan when auth is required,
   * otherwise passes them through unchanged.
   */
  private applyAuthPolicy(scenarios: QaScenario[], config: RunConfig): QaScenario[] {
    if (config.auth.kind === 'none') {
      return scenarios;
    }
    return this.authenticatedPlan(scenarios, config);
  }

  private topoSort(tasks: QaTask[]): QaTask[] {
    const ids = new Set(tasks.map((t) => t.id));
    const sanitized = tasks.map((t) => ({ ...t, dependsOn: t.dependsOn?.filter((d) => ids.has(d)) }));
    const visited = new Set<string>();
    const stack = new Set<string>();
    const result: QaTask[] = [];
    const map = new Map(sanitized.map((t) => [t.id, t] as const));

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (stack.has(id)) return;
      stack.add(id);
      const task = map.get(id);
      if (!task) return;
      for (const dep of task.dependsOn ?? []) visit(dep);
      stack.delete(id);
      visited.add(id);
      result.push(task);
    };

    for (const t of sanitized) visit(t.id);
    return result;
  }

  private async fallback(config: RunConfig): Promise<QaScenario[]> {
    const lines = this.compactCriteria(config);
    const items = lines.length ? lines : [config.demand.description];
    const tasks: QaTask[] = await Promise.all(items.map(async (line, index) => {
      const t: QaTask = {
        id: `T${String(index + 1).padStart(3, '0')}`,
        title: line,
        expected: line,
        status: 'PENDING',
        dependsOn: index === 0 ? undefined : [`T${String(index).padStart(3, '0')}`],
        intent: this.detectIntent(line),
      };
      t.expectedOutcome = await this.outcomeResolver.resolve(config, t);
      return t;
    }));
    return [{
      id: 'scenario-001',
      title: config.demand.title,
      status: 'PLANNED',
      intent: 'POSITIVE',
      tasks,
    }];
  }

  private compactCriteria(config: RunConfig): string[] {
    const criteria = config.demand.acceptanceCriteria ?? config.demand.description.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!criteria.length) return [config.demand.description];
    return criteria.slice(0, 4);
  }

  private authAwareTasks(tasks: QaTask[], config: RunConfig): QaTask[] {
    if (config.auth.kind === 'none') return tasks;
    const kept = tasks.filter((task) => !this.isLoginTask(task));
    if (kept.length) return this.relinkDependencies(kept);
    return [this.fallbackAuthTask(config)];
  }

  private authenticatedPlan(scenarios: QaScenario[], config: RunConfig): QaScenario[] {
    const tasks = scenarios.flatMap((scenario) => scenario.tasks).filter((task) => !this.isLoginTask(task));
    const logout = tasks.find((task) => this.isLogoutTask(task));
    const beforeLogout = tasks.filter((task) => !this.isLogoutTask(task));
    const ordered = logout ? [...beforeLogout, logout] : beforeLogout;
    const finalTasks = ordered.length ? ordered : [this.fallbackAuthTask(config)];
    return [{
      id: 'scenario-001',
      title: config.demand.title,
      status: 'PLANNED',
      intent: 'POSITIVE',
      tasks: this.sequential(finalTasks),
    }];
  }

  private enforcePlanPolicy(scenarios: QaScenario[], config: RunConfig): QaScenario[] {
    const limit = config.auth.kind === 'none' ? 8 : 6;
    return scenarios.map((scenario) => {
      const unique = this.dedupe(scenario.tasks).filter((task) => !this.isLowValueTask(task));
      const logout = unique.find((task) => this.isLogoutTask(task));
      const body = unique.filter((task) => !this.isLogoutTask(task)).slice(0, logout ? limit - 1 : limit);
      const ordered = logout ? [...body, logout] : body;
      const tasks = config.auth.kind === 'none' ? this.relinkDependencies(ordered) : this.sequential(ordered);
      return { ...scenario, tasks: tasks.length ? tasks : [this.fallbackAuthTask(config)] };
    });
  }

  private canonicalTask(task: QaTask): QaTask {
    const kind = task.expectedOutcome?.kind;
    if (kind) {
      const normalized = this.expectedTextForOutcome(kind);
      if (normalized) return { ...task, expected: normalized };
    }
    return task;
  }

  private expectedTextForOutcome(kind: ExpectedOutcome['kind']): string | undefined {
    switch (kind) {
      case 'DEAUTHENTICATION':
        return 'Expected deauthentication state is visible';
      case 'APPEARANCE_CHANGE':
        return 'Expected appearance state changes visibly';
      case 'DISCLOSURE':
        return 'Expected disclosure surface is visible';
      case 'AUTHENTICATION':
        return 'Expected authenticated state is visible';
      default:
        return undefined;
    }
  }

  private fallbackAuthTask(config: RunConfig): QaTask {
    const criteria = this.compactCriteria(config);
    const title = criteria[0] ?? config.demand.title;
    return {
      id: 'T001',
      title,
      expected: title,
      status: 'PENDING',
      intent: 'POSITIVE',
    };
  }

  private isLogoutTask(task: QaTask): boolean {
    return task.expectedOutcome?.kind === 'DEAUTHENTICATION';
  }

  private isLoginTask(task: QaTask): boolean {
    if (this.isLogoutTask(task)) return false;
    return task.expectedOutcome?.kind === 'AUTHENTICATION';
  }

  private isGlobalSafetyTask(task: QaTask): boolean {
    return task.expectedOutcome?.kind === 'NO_REGRESSION';
  }

  private isLowValueTask(_task: QaTask): boolean {
    return false;
  }

  private dedupe(tasks: QaTask[]): QaTask[] {
    const seen = new Set<string>();
    return tasks.filter((task) => {
      const key = `${task.title} ${task.expected}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\W+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private sequential(tasks: QaTask[]): QaTask[] {
    return tasks.map((task, index) => ({
      ...task,
      id: `T${String(index + 1).padStart(3, '0')}`,
      dependsOn: index === 0 ? undefined : [`T${String(index).padStart(3, '0')}`],
      status: 'PENDING',
    }));
  }

  private relinkDependencies(tasks: QaTask[]): QaTask[] {
    const ids = new Set(tasks.map((task) => task.id));
    return tasks.map((task) => ({ ...task, dependsOn: task.dependsOn?.filter((id) => ids.has(id)) }));
  }

  private detectIntent(_line: string): ScenarioIntent {
    return 'POSITIVE';
  }
}
