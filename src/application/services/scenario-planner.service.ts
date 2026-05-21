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
    const normalized = scenarios.map((s) => ({ ...s, tasks: this.authAwareTasks(this.topoSort(s.tasks).map((task) => this.canonicalTask(task)), config) }));
    return this.enforcePlanPolicy(config.auth.kind === 'none' ? normalized : this.authenticatedPlan(normalized, config), config);
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
    return criteria.filter((line) => !this.isGlobalSafetyText(line)).slice(0, 4);
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
    const text = `${task.title} ${task.expected}`.toLowerCase();
    if (this.isLogoutTask(task)) return { ...task, expected: 'Logout retorna para tela de login ou estado não autenticado visível' };
    if (/\b(tema|theme|apar[eê]ncia|appearance|modo escuro|dark mode|light mode)\b/i.test(text)) {
      return { ...task, expected: 'Tema visual alterna e a opção/estado visual alterado fica visível' };
    }
    if (/\b(menu|conta|opções|opcoes|settings|configurações|configuracoes)\b/i.test(text)) {
      return { ...task, expected: 'Menu ou painel solicitado fica visível com itens acionáveis' };
    }
    if (/(área autenticada|area autenticada|authenticated area)/i.test(text)) {
      return { ...task, expected: 'Área autenticada está visível e não está na tela de login' };
    }
    return task;
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
    if (/(área autenticada|area autenticada|authenticated area|não está na tela de login|nao esta na tela de login)/i.test(text)) return false;
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

  private isLowValueTask(task: QaTask): boolean {
    const text = `${task.title} ${task.expected}`.toLowerCase();
    return /^(clicar|click|avançar|advance|interagir|verificar tela|validar tela)\b/.test(text.trim());
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

  private detectIntent(line: string): ScenarioIntent {
    const lower = line.toLowerCase();
    if (/(invalid|inválid|erro|fail|negativ)/.test(lower)) return 'NEGATIVE';
    if (/(borda|edge|limit|máximo|maxim)/.test(lower)) return 'EDGE';
    return 'POSITIVE';
  }
}
