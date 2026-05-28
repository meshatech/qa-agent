import type { QaTask } from '../../../domain/models/run.model.js';
import type { RunConfig } from '../../../domain/schemas/config.schema.js';
import type { ExecutionStep } from '../../../domain/schemas/execution-plan.schema.js';
import type { StepMatcher } from './step-matcher.interface.js';

export class AuthAreaStepMatcher implements StepMatcher {
  priority = 10;

  canHandle(task: QaTask): boolean {
    const text = `${task.title} ${task.expected}`;
    return /(área autenticada|area autenticada|authenticated area)/i.test(text);
  }

  createSteps(scenarioId: string, task: QaTask): ExecutionStep[] {
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
}

export class MenuStepMatcher implements StepMatcher {
  priority = 20;

  canHandle(task: QaTask): boolean {
    const text = `${task.title} ${task.expected}`;
    const isMenu = /\b(menu|conta|opções|opcoes|settings|configurações|configuracoes)\b/i.test(text);
    if (!isMenu) return false;
    return !LogoutStepMatcher.isLogout(text) && !ThemeStepMatcher.isTheme(text);
  }

  createSteps(scenarioId: string, task: QaTask): ExecutionStep[] {
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
}

export class ThemeStepMatcher implements StepMatcher {
  priority = 30;

  static isTheme(text: string): boolean {
    const t = text.toLowerCase();
    const isMenuPrep =
      /\b(menu|conta|opções|opcoes|settings|configurações|configuracoes)\b/i.test(t) &&
      /\b(antes|before|visível|visivel|visible|verificar|check)\b/i.test(t);
    if (isMenuPrep) return false;
    return /\b(tema|theme|apar[eê]ncia|appearance|modo escuro|dark mode|light mode|escuro|claro)\b/i.test(t);
  }

  canHandle(task: QaTask): boolean {
    return ThemeStepMatcher.isTheme(`${task.title} ${task.expected}`);
  }

  createSteps(scenarioId: string, task: QaTask): ExecutionStep[] {
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
}

export class LogoutStepMatcher implements StepMatcher {
  priority = 40;

  static isLogout(text: string): boolean {
    return /\b(logout|deslogar|sair|encerrar sessão|sign out)\b/i.test(text);
  }

  canHandle(task: QaTask): boolean {
    return LogoutStepMatcher.isLogout(`${task.title} ${task.expected}`);
  }

  createSteps(scenarioId: string, task: QaTask): ExecutionStep[] {
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
}

export class RouteStepMatcher implements StepMatcher {
  priority = 50;

  canHandle(task: QaTask): boolean {
    return /(\/[\w-]+(?:\/[\w-]+)*)/.test(`${task.title} ${task.expected}`);
  }

  createSteps(scenarioId: string, task: QaTask, config: RunConfig): ExecutionStep[] {
    const routeMatch = `${task.title} ${task.expected}`.match(/(\/[\w-]+(?:\/[\w-]+)*)/);
    const route = routeMatch![1]!;
    const url = `${config.baseUrl}${route}`;
    return [{
      id: `${task.id}-navigate`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action: { type: 'navigate', to: url, reason: task.title },
      postconditions: [{ type: 'url_contains', value: route }],
      assertions: [],
      onFailure: 'RECOVER',
    }];
  }
}

export class ClickStepMatcher implements StepMatcher {
  priority = 60;

  canHandle(task: QaTask): boolean {
    return /\b(clicar|click|selecionar|selecionar opção|abrir menu)\b/i.test(task.title);
  }

  createSteps(scenarioId: string, task: QaTask): ExecutionStep[] {
    return [{
      id: `${task.id}-click`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action: {
        type: 'click',
        target: {
          strategy: 'semantic',
          semanticKey: `action_${task.id}`,
          intent: task.title,
          candidates: [
            { strategy: 'text_any', texts: [task.title] },
            { strategy: 'role', role: 'button', name: task.title },
          ],
        },
        reason: task.title,
      },
      postconditions: [{ type: 'no_console_errors' }],
      assertions: [],
      onFailure: 'RECOVER',
    }];
  }
}

export class FillStepMatcher implements StepMatcher {
  priority = 70;

  canHandle(task: QaTask): boolean {
    return /\b(preencher|fill|digitar|type)\b/i.test(task.title);
  }

  createSteps(scenarioId: string, task: QaTask): ExecutionStep[] {
    return [{
      id: `${task.id}-fill`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action: {
        type: 'fill',
        target: {
          strategy: 'semantic',
          semanticKey: `input_${task.id}`,
          intent: task.title,
          candidates: [
            { strategy: 'text_any', texts: [task.title] },
            { strategy: 'role', role: 'textbox', name: task.title },
          ],
        },
        value: 'safe-test-value',
        reason: task.title,
      },
      postconditions: [{ type: 'no_console_errors' }],
      assertions: [],
      onFailure: 'RECOVER',
    }];
  }
}

export class NavigateStepMatcher implements StepMatcher {
  priority = 100;

  canHandle(): boolean {
    return true;
  }

  createSteps(scenarioId: string, task: QaTask, config: RunConfig): ExecutionStep[] {
    return [{
      id: `${task.id}-step`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action: { type: 'navigate', to: config.baseUrl, reason: task.title },
      postconditions: task.expected.length <= 40 ? [{ type: 'text_visible', text: task.expected }] : [{ type: 'no_console_errors' }],
      assertions: [],
      onFailure: 'RECOVER',
    }];
  }
}

/**
 * Registry of StepMatchers ordered by priority (lowest first).
 * The last matcher (NavigateStepMatcher) is a catch-all fallback.
 */
export const STEP_MATCHERS: readonly StepMatcher[] = [
  new AuthAreaStepMatcher(),
  new MenuStepMatcher(),
  new ThemeStepMatcher(),
  new LogoutStepMatcher(),
  new RouteStepMatcher(),
  new ClickStepMatcher(),
  new FillStepMatcher(),
  new NavigateStepMatcher(),
];
