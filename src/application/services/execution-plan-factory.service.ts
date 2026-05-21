import { Injectable } from '@nestjs/common';
import type { ExecutionPlan, ExecutionStep } from '../../domain/schemas/execution-plan.schema.js';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

@Injectable()
export class ExecutionPlanFactoryService {
  fromScenarios(config: RunConfig, scenarios: QaScenario[]): ExecutionPlan | undefined {
    const steps = scenarios.flatMap((scenario) => scenario.tasks.flatMap((task) => this.stepsForTask(scenario.id, task)));
    if (!steps.length) return undefined;
    return {
      schemaVersion: 'execution-plan.v1',
      planId: `plan_${config.demand.id}`,
      version: 1,
      goal: config.demand.title,
      mode: config.runtime.mode,
      runtime: {
        maxAttemptsPerStep: config.runtime.maxAttemptsPerStep,
        maxReplansPerScenario: config.runtime.maxReplansPerScenario,
        destructiveActionPolicy: config.runtime.destructiveActionPolicy,
      },
      steps,
      assertions: [],
    };
  }

  private stepsForTask(scenarioId: string, task: QaTask): ExecutionStep[] {
    const text = `${task.title} ${task.expected}`;
    if (/(área autenticada|area autenticada|authenticated area)/i.test(text)) {
      return [{
        id: `${task.id}-auth`,
        scenarioId,
        taskId: task.id,
        description: task.title,
        preconditions: [],
        action: { type: 'waitForStable', timeoutMs: 1000, reason: 'authenticated state already prepared by runtime auth' },
        postconditions: [{ type: 'text_any_visible', texts: ['Caixa de entrada', 'Inbox', 'Configurações', 'Settings'] }],
        assertions: [],
        onFailure: 'CONTINUE_WITH_WARNING',
      }];
    }
    if (/(menu|conta|opções|opcoes|settings|configurações|configuracoes)/i.test(text) && !this.isLogoutTask(task) && !this.isThemeTask(task)) {
      return [{
        id: `${task.id}-menu`,
        scenarioId,
        taskId: task.id,
        description: task.title,
        preconditions: [],
        action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Conta e opções' }, reason: 'open account menu' },
        postconditions: [{ type: 'text_any_visible', texts: ['Sair', 'Logout', 'Tema', 'Theme', 'Configurações'] }],
        assertions: [],
        onFailure: 'ASK_LLM_TO_REPLAN',
      }];
    }
    if (this.isThemeTask(task)) {
      return [{
        id: `${task.id}-theme`,
        scenarioId,
        taskId: task.id,
        description: task.title,
        preconditions: [],
        action: {
          type: 'click',
          target: {
            strategy: 'semantic',
            semanticKey: 'appearance_toggle',
            intent: 'toggle application appearance mode',
            candidates: [
              { strategy: 'text_any', texts: ['Tema escuro', 'Tema claro', 'Dark theme', 'Light theme', 'Escuro', 'Claro'] },
              { strategy: 'role', role: 'menuitem', name: 'Tema escuro' },
              { strategy: 'role', role: 'menuitem', name: 'Tema claro' },
              { strategy: 'role', role: 'button', name: 'Tema escuro' },
              { strategy: 'role', role: 'button', name: 'Tema claro' },
            ],
          },
          reason: 'toggle application appearance mode',
        },
        postconditions: [{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'changed', source: 'dom' }],
        assertions: [],
        onFailure: 'RECOVER',
      }];
    }
    if (this.isLogoutTask(task)) {
      return [{
        id: `${task.id}-logout-menu`,
        scenarioId,
        taskId: task.id,
        description: 'Abrir menu de logout',
        preconditions: [],
        action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Conta e opções' }, reason: 'open account menu for logout' },
        postconditions: [{ type: 'text_any_visible', texts: ['Sair', 'Logout', 'Sign out'] }],
        assertions: [],
        onFailure: 'ASK_LLM_TO_REPLAN',
      }, {
        id: `${task.id}-logout-click`,
        scenarioId,
        taskId: task.id,
        description: 'Clicar em Sair e validar estado não autenticado',
        preconditions: [{ type: 'text_any_visible', texts: ['Sair', 'Logout', 'Sign out'] }],
        action: {
          type: 'click',
          target: {
            strategy: 'semantic',
            semanticKey: 'logout_action',
            intent: 'sign out from the application',
            candidates: [
              { strategy: 'role', role: 'menuitem', name: 'Sair' },
              { strategy: 'role', role: 'button', name: 'Sair' },
              { strategy: 'text_any', texts: ['Sair', 'Logout', 'Sign out', 'Encerrar sessão'] },
            ],
          },
          reason: 'click logout menu item',
        },
        postconditions: [{ type: 'auth_state', expected: 'anonymous' }],
        assertions: [],
        onFailure: 'RECOVER',
      }];
    }
    return [];
  }

  private isLogoutTask(task: QaTask): boolean {
    return /\b(logout|deslogar|sair|encerrar sessão|sign out)\b/i.test(`${task.title} ${task.expected}`);
  }

  private isThemeTask(task: QaTask): boolean {
    const title = task.title.toLowerCase();
    const text = `${task.title} ${task.expected}`.toLowerCase();
    const menuPreparation =
      /\b(menu|conta|opções|opcoes|settings|configurações|configuracoes)\b/i.test(title) &&
      /\b(antes|before|visível|visivel|visible|verificar|check)\b/i.test(title);
    if (menuPreparation) return false;
    return /\b(tema|theme|apar[eê]ncia|appearance|modo escuro|dark mode|light mode|escuro|claro)\b/i.test(text);
  }
}
