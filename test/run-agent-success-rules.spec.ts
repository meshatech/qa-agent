import { RunAgentUseCase } from '../src/application/use-cases/run-agent.usecase.js';
import { SemanticIntentDetectorService } from '../src/application/services/semantic-intent-detector.service.js';
import { describe, expect, it } from 'vitest';

const useCase = Object.create(RunAgentUseCase.prototype) as {
  stepSucceeded(task: { title: string; expected: string; expectedOutcome?: { kind: string; description?: string } }, action: { type: string; reason?: string }, execOk: boolean, validationOk: boolean, recoveredOk: boolean, expected: { type: string; value?: string; text?: string }, changed: boolean): boolean;
  isPreActionWeakExpected(task: { title: string; expected: string }, action: { type: string; targetElementId?: string }, expected: unknown): boolean;
  semanticDecisionIssue(task: { title: string; expected: string; expectedOutcome?: { kind: string; description?: string } }, action: { type: string; targetElementId?: string }, expected: { type: string; value?: string; text?: string; target?: { originalElementId: string } }, obs: { elements: Array<{ id: string; name: string; text?: string }> }): string | undefined;
  promoteThemeMenuExpectation(task: { title: string; expected: string; expectedOutcome?: { kind: string; description?: string } }, action: { type: string; targetElementId?: string }, bound: { type: string }, obs: { elements: Array<{ id: string; name: string; text?: string }> }): { type: 'text_visible'; text: string } | undefined;
  promoteLogoutMenuExpectation(task: { title: string; expected: string; expectedOutcome?: { kind: string; description?: string } }, action: { type: string; targetElementId?: string }, bound: { type: string }, obs: { elements: Array<{ id: string; name: string; text?: string }> }): { type: 'text_visible'; text: string } | undefined;
  promoteMenuExpectation(task: { title: string; expected: string; expectedOutcome?: { kind: string; description?: string } }, action: { type: string; targetElementId?: string }, bound: { type: string }, obs: { elements: Array<{ id: string; name: string; text?: string }> }): { type: 'text_visible'; text: string } | undefined;
  intentAutocorrectEnvelope(task: { title: string; expected: string; expectedOutcome?: { kind: string; description?: string } }, obs: { observationId: string; elements: Array<{ id: string; name: string; text?: string; inViewport: boolean }> }, issue: string): { action: { type: string; targetElementId?: string }; expected_after_action: { type: string; text?: string } } | undefined;
  taskDecisionContext(task: { id?: string; title: string; expected: string; expectedOutcome?: { kind: string; description?: string }; attempts?: Array<{ actionType: string; reason?: string; result: string }> }, scenarioId: string, cycle: number, semanticIssue?: string): string;
  isTaskAlreadySatisfied(task: { title: string; expected: string; expectedOutcome?: { kind: string; description?: string } }, config: { auth: { kind: string } }, obs: { url: string; visibleTexts: string[]; elements: Array<{ role: string; inViewport: boolean }> }): boolean;
  logoutObservationValidation(obs: { url: string; visibleTexts: string[]; elements: Array<{ role?: string; name: string; text?: string; inViewport?: boolean }> }): { result: { ok: boolean } };
  themeObservationValidation(before: { url: string; title: string; visibleTexts: string[]; pageState: unknown; elements: Array<{ role: string; name: string; text?: string; checked?: boolean; selected?: boolean; expanded?: boolean; disabled?: boolean; inViewport: boolean }> }, after: { url: string; title: string; visibleTexts: string[]; pageState: unknown; elements: Array<{ role: string; name: string; text?: string; checked?: boolean; selected?: boolean; expanded?: boolean; disabled?: boolean; inViewport: boolean }> }, label: string): { result: { ok: boolean }; boundExpected: { type: string; text?: string } };
  observationMeaningfullyChanged(before: { url: string; title: string; visibleTexts: string[]; pageState: unknown; elements: Array<{ role: string; name: string; text?: string; checked?: boolean; selected?: boolean; expanded?: boolean; disabled?: boolean; inViewport: boolean }> }, after: { url: string; title: string; visibleTexts: string[]; pageState: unknown; elements: Array<{ role: string; name: string; text?: string; checked?: boolean; selected?: boolean; expanded?: boolean; disabled?: boolean; inViewport: boolean }> }): boolean;
  memory: { context: () => string };
  intentDetector: SemanticIntentDetectorService;
};

useCase.memory = { context: () => 'Working memory:\n- Tried: click el_001 -> REJECTED' };
useCase.intentDetector = new SemanticIntentDetectorService();

describe('RunAgentUseCase success rules', () => {
  it('does not pass failed assertion actions just because secondary validation passed', () => {
    const task = { title: 'Verificar', expected: 'Visível' };
    expect(useCase.stepSucceeded(task, { type: 'assertVisible' }, false, true, true, { type: 'no_console_errors' }, true)).toBe(false);
    expect(useCase.stepSucceeded(task, { type: 'assertText' }, false, true, true, { type: 'no_console_errors' }, true)).toBe(false);
  });

  it('allows non-assertive actions to pass when recovery makes validation true', () => {
    expect(useCase.stepSucceeded({ title: 'Abrir menu', expected: 'Menu aberto' }, { type: 'click' }, false, true, true, { type: 'text_visible' }, true)).toBe(true);
  });

  it('rejects element_visible validation that only proves the clicked target still exists', () => {
    expect(useCase.isPreActionWeakExpected(
      { title: 'Trocar tema', expected: 'Tema alterado' },
      { type: 'click', targetElementId: 'el_001' },
      { type: 'element_visible', target: { originalElementId: 'el_001' } },
    )).toBe(true);
  });

  it('does not pre-block no_console_errors for functional tasks before the action runs', () => {
    expect(useCase.isPreActionWeakExpected(
      { title: 'Verificar logout', expected: 'Logout retorna para tela de login' },
      { type: 'click', targetElementId: 'el_001' },
      { type: 'no_console_errors' },
    )).toBe(false);
  });

  it('requires observed change before no_console_errors can complete a functional task', () => {
    expect(useCase.stepSucceeded(
      { title: 'Verificar menu', expected: 'Menu visível' },
      { type: 'click' },
      true,
      true,
      false,
      { type: 'no_console_errors' },
      false,
    )).toBe(false);
    expect(useCase.stepSucceeded(
      { title: 'Verificar menu', expected: 'Menu visível' },
      { type: 'click' },
      true,
      true,
      false,
      { type: 'no_console_errors' },
      true,
    )).toBe(true);
  });

  it('does not complete a theme task when it only opened the menu and made the theme option visible', () => {
    expect(useCase.stepSucceeded(
      { title: 'Alterar tema visual', expected: 'Tema visual da aplicação foi alterado', expectedOutcome: { kind: 'APPEARANCE_CHANGE', description: 'theme' } },
      { type: 'click', reason: 'open settings menu' },
      true,
      true,
      false,
      { type: 'text_visible', text: 'Tema' },
      true,
    )).toBe(false);
  });

  it('allows a theme task to complete after a real theme click with a stronger proof', () => {
    expect(useCase.stepSucceeded(
      { title: 'Alterar tema visual', expected: 'Tema visual da aplicação foi alterado' },
      { type: 'click', reason: 'toggle dark theme' },
      true,
      true,
      false,
      { type: 'text_visible', text: 'Escuro' },
      true,
    )).toBe(true);
  });

  it('rejects no_console_errors as logout proof even when the page changed', () => {
    expect(useCase.stepSucceeded(
      { title: 'Verificar logout', expected: 'Logout retorna para tela de login', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
      { type: 'click' },
      true,
      true,
      false,
      { type: 'no_console_errors' },
      true,
    )).toBe(false);
  });

  it('promotes logout menu clicks from no_console_errors to visible logout proof', () => {
    expect(useCase.promoteLogoutMenuExpectation(
      { title: 'Verificar logout', expected: 'Logout retorna para tela inicial não autenticada', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
      { type: 'click', targetElementId: 'el_001' },
      { type: 'no_console_errors' },
      { elements: [{ id: 'el_001', name: 'Conta e opções' }] },
    )).toEqual({ type: 'text_visible', text: 'Verificar logout' });
  });

  it('promotes account menu tasks from no_console_errors to a visible menu-item proof', () => {
    expect(useCase.promoteMenuExpectation(
      { title: 'Verificar menu de conta ou configurações', expected: 'Menu ou painel solicitado fica visível com itens acionáveis', expectedOutcome: { kind: 'DISCLOSURE', description: 'menu' } },
      { type: 'click', targetElementId: 'el_001' },
      { type: 'no_console_errors' },
      { elements: [{ id: 'el_001', name: 'Conta e opções' }] },
    )).toEqual({ type: 'text_visible', text: 'Verificar menu de conta ou configurações' });
  });

  it('does not complete logout when it only opened the menu and revealed logout text', () => {
    expect(useCase.stepSucceeded(
      { title: 'Verificar logout', expected: 'Logout retorna para tela inicial não autenticada', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
      { type: 'click', reason: 'open account menu' },
      true,
      true,
      false,
      { type: 'text_visible', text: 'Sair' },
      true,
    )).toBe(false);
  });

  it('autocorrects weak logout decisions to opening the account menu', () => {
    const envelope = useCase.intentAutocorrectEnvelope(
      { title: 'Abrir conta e opções para verificar logout', expected: 'Logout retorna para tela inicial não autenticada', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
      { observationId: 'obs_1', elements: [{ id: 'el_001', name: 'Conta e opções', inViewport: true }] },
      'Logout action must prove a non-authenticated state',
    );

    expect(envelope?.action.targetElementId).toBe('el_001');
    expect(envelope?.expected_after_action).toEqual({ type: 'text_visible', text: 'Abrir conta e opções para verificar logout' });
  });

  it('autocorrects weak theme decisions to opening the account menu', () => {
    const envelope = useCase.intentAutocorrectEnvelope(
      { title: 'Abrir conta e opções para alterar tema visual', expected: 'Tema alternado' },
      { observationId: 'obs_1', elements: [{ id: 'el_001', name: 'Conta e opções', inViewport: true }] },
      'Functional task cannot use no_console_errors',
    );

    expect(envelope?.action.targetElementId).toBe('el_001');
    expect(envelope?.expected_after_action).toEqual({ type: 'text_visible', text: 'Abrir conta e opções para alterar tema visual' });
  });

  it('accepts logout proof when URL clearly points to login', () => {
    expect(useCase.stepSucceeded(
      { title: 'Verificar logout', expected: 'Logout retorna para tela de login' },
      { type: 'click' },
      true,
      true,
      false,
      { type: 'url_contains', value: '/login' },
      true,
    )).toBe(true);
  });

  it('recognizes non-authenticated login state by visible login inputs after semantic logout', () => {
    const validation = useCase.logoutObservationValidation({
      url: 'https://app.local/',
      visibleTexts: ['Entrar', 'E-mail', 'Senha'],
      elements: [{ role: 'textbox', name: 'E-mail', inViewport: true }, { role: 'textbox', name: 'Senha', inViewport: true }],
    });

    expect(validation.result.ok).toBe(true);
  });

  it('pre-satisfies authenticated area checks from current non-login app state', () => {
    expect(useCase.isTaskAlreadySatisfied(
      { title: 'Verificar área autenticada', expected: 'Área autenticada visível', expectedOutcome: { kind: 'AUTHENTICATION', description: 'auth' } },
      { auth: { kind: 'formLogin' } },
      { url: 'https://app.local/', visibleTexts: ['Caixa de entrada'], elements: [{ role: 'button', inViewport: true }] },
    )).toBe(true);
  });

  it('does not pre-satisfy authenticated area checks on login routes', () => {
    expect(useCase.isTaskAlreadySatisfied(
      { title: 'Verificar área autenticada', expected: 'Área autenticada visível' },
      { auth: { kind: 'formLogin' } },
      { url: 'https://app.local/login', visibleTexts: ['Entrar'], elements: [{ role: 'button', inViewport: true }] },
    )).toBe(false);
  });

  it('feeds previous weak-validation failure back into the next LLM decision', () => {
    const context = useCase.taskDecisionContext({
      id: 'T001',
      title: 'Trocar tema da aplicação',
      expected: 'Tema alterado',
      expectedOutcome: { kind: 'APPEARANCE_CHANGE', description: 'theme' },
      attempts: [{ actionType: 'click', result: 'FAILED', reason: 'Weak validation: expected_after_action does not prove the requested state change' }],
    }, 'scenario-001', 1, 'Functional task cannot use no_console_errors as primary success proof');

    expect(context).toContain('Previous failed attempts');
    expect(context).toContain('Do not repeat the same weak action/validation');
    expect(context).toContain('For theme-change tasks');
    expect(context).toContain('Working memory');
    expect(context).toContain('Last rejected LLM decision');
  });

  it('rejects semantic no_console_errors decisions for theme tasks before execution', () => {
    expect(useCase.semanticDecisionIssue(
      { title: 'Trocar tema da aplicação', expected: 'Tema alterado', expectedOutcome: { kind: 'APPEARANCE_CHANGE', description: 'theme' } },
      { type: 'click', targetElementId: 'el_001' },
      { type: 'no_console_errors' },
      { elements: [{ id: 'el_001', name: 'Conta e opções' }] },
    )).toContain('Theme-change task cannot use no_console_errors');
  });

  it('promotes theme menu clicks from no_console_errors to a visible theme proof', () => {
    expect(useCase.promoteThemeMenuExpectation(
      { title: 'Trocar tema da aplicação', expected: 'Tema alterado', expectedOutcome: { kind: 'APPEARANCE_CHANGE', description: 'theme' } },
      { type: 'click', targetElementId: 'el_001' },
      { type: 'no_console_errors' },
      { elements: [{ id: 'el_001', name: 'Conta e opções' }] },
    )).toEqual({ type: 'text_visible', text: 'Trocar tema da aplicação' });
  });

  it('accepts semantic theme validation when the label toggles', () => {
    const before = {
      url: 'https://app.local/',
      title: 'Inbox',
      visibleTexts: ['Tema escuro'],
      pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
      elements: [{ role: 'button', name: 'Tema escuro', inViewport: true }],
    };
    const after = {
      ...before,
      visibleTexts: ['Tema claro'],
      elements: [{ role: 'button', name: 'Tema claro', inViewport: true }],
    };
    const validation = useCase.themeObservationValidation(before, after, 'Tema escuro');

    expect(validation.result.ok).toBe(true);
    expect(validation.boundExpected.text).toBe('UI state changed');
  });

  it('rejects theme task that still tries to use no_console_errors even on a real theme control', () => {
    expect(useCase.semanticDecisionIssue(
      { title: 'Trocar tema da aplicação', expected: 'Tema alterado' },
      { type: 'click', targetElementId: 'el_007' },
      { type: 'no_console_errors' },
      { elements: [{ id: 'el_007', name: 'Tema escuro' }] },
    )).toContain('Functional task cannot use no_console_errors');
  });

  it('does not treat observationId churn as proof of meaningful UI change', () => {
    expect(useCase.observationMeaningfullyChanged(
      {
        url: 'https://app.local/',
        title: 'Inbox',
        visibleTexts: ['Inbox', 'Configurações'],
        pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
        elements: [{ role: 'button', name: 'Conta', inViewport: true }],
      },
      {
        url: 'https://app.local/',
        title: 'Inbox',
        visibleTexts: ['Inbox', 'Configurações'],
        pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
        elements: [{ role: 'button', name: 'Conta', inViewport: true }],
      },
    )).toBe(false);
  });

  it('detects meaningful UI change when the visible option set changes', () => {
    expect(useCase.observationMeaningfullyChanged(
      {
        url: 'https://app.local/',
        title: 'Inbox',
        visibleTexts: ['Inbox', 'Conta'],
        pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
        elements: [{ role: 'button', name: 'Conta', inViewport: true }],
      },
      {
        url: 'https://app.local/',
        title: 'Inbox',
        visibleTexts: ['Inbox', 'Tema escuro', 'Sair'],
        pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
        elements: [{ role: 'button', name: 'Tema escuro', inViewport: true }],
      },
    )).toBe(true);
  });
});
