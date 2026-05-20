import { Inject, Injectable } from '@nestjs/common';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import type { QaScenario, QaTask, ScenarioIntent } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

@Injectable()
export class ScenarioPlannerService {
  constructor(@Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort) {}

  async plan(config: RunConfig): Promise<QaScenario[]> {
    let scenarios: QaScenario[] | undefined;
    try {
      scenarios = await this.decision.plan?.(config);
    } catch {
      scenarios = undefined;
    }
    if (!scenarios?.length) scenarios = this.fallback(config);
    const normalized = scenarios.map((s) => ({ ...s, tasks: this.authAwareTasks(this.topoSort(s.tasks), config) }));
    return config.auth.kind === 'none' ? normalized : this.authenticatedPlan(normalized, config);
  }

  topoSort(tasks: QaTask[]): QaTask[] {
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

  private fallback(config: RunConfig): QaScenario[] {
    const lines = this.compactCriteria(config);
    const items = lines.length ? lines : [config.demand.description];
    const tasks: QaTask[] = items.map((line, index) => ({
      id: `T${String(index + 1).padStart(3, '0')}`,
      title: line,
      expected: line,
      status: 'PENDING',
      dependsOn: index === 0 ? undefined : [`T${String(index).padStart(3, '0')}`],
      intent: this.detectIntent(line),
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
    return criteria.filter((line) => !this.isGlobalSafetyText(line)).slice(0, 5);
  }

  private authAwareTasks(tasks: QaTask[], config: RunConfig): QaTask[] {
    if (config.auth.kind === 'none') return tasks;
    const kept = tasks.filter((task) => !this.isLoginTask(task) && !this.isGlobalSafetyTask(task));
    if (kept.length) return this.relinkDependencies(kept);
    return [this.fallbackAuthTask(config)];
  }

  private authenticatedPlan(scenarios: QaScenario[], config: RunConfig): QaScenario[] {
    const tasks = scenarios.flatMap((scenario) => scenario.tasks).filter((task) => !this.isLoginTask(task) && !this.isGlobalSafetyTask(task));
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

  private isLoginTask(task: QaTask): boolean {
    if (this.isLogoutTask(task)) return false;
    const text = `${task.title} ${task.expected}`.toLowerCase();
    return /\b(login|logar|entrar|senha|password|e-?mail|email|submit|credenciais?)\b/i.test(text);
  }

  private isLogoutTask(task: QaTask): boolean {
    const text = `${task.title} ${task.expected}`.toLowerCase();
    return /\b(logout|deslogar|sair|encerrar sessão|sign out)\b/i.test(text);
  }

  private isGlobalSafetyTask(task: QaTask): boolean {
    return this.isGlobalSafetyText(`${task.title} ${task.expected}`);
  }

  private isGlobalSafetyText(text: string): boolean {
    return /Nenhuma ação destrutiva|não execução de ações destrutivas|sem erro HTTP 5xx|erro crítico de console|falhas de rede|envio real/i.test(text);
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

  private detectIntent(line: string): ScenarioIntent {
    const lower = line.toLowerCase();
    if (/(invalid|inválid|erro|fail|negativ)/.test(lower)) return 'NEGATIVE';
    if (/(borda|edge|limit|máximo|maxim)/.test(lower)) return 'EDGE';
    return 'POSITIVE';
  }
}
