import { describe, expect, it } from 'vitest';
import { RunAgentUseCase } from '../src/application/use-cases/run-agent.usecase.js';

const useCase = Object.create(RunAgentUseCase.prototype) as {
  stepSucceeded(task: { title: string; expected: string }, action: { type: string }, execOk: boolean, validationOk: boolean, recoveredOk: boolean, expected: { type: string; value?: string; text?: string }, changed: boolean): boolean;
  isPreActionWeakExpected(task: { title: string; expected: string }, action: { type: string; targetElementId?: string }, expected: unknown): boolean;
  taskDecisionContext(task: { title: string; expected: string; attempts?: Array<{ actionType: string; reason?: string; result: string }> }, cycle: number): string;
  isTaskAlreadySatisfied(task: { title: string; expected: string }, config: { auth: { kind: string } }, obs: { url: string; visibleTexts: string[]; elements: Array<{ role: string; inViewport: boolean }> }): boolean;
  logoutObservationValidation(obs: { url: string; visibleTexts: string[]; elements: Array<{ name: string; text?: string }> }): { result: { ok: boolean } };
};

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

  it('rejects no_console_errors as logout proof even when the page changed', () => {
    expect(useCase.stepSucceeded(
      { title: 'Verificar logout', expected: 'Logout retorna para tela de login' },
      { type: 'click' },
      true,
      true,
      false,
      { type: 'no_console_errors' },
      true,
    )).toBe(false);
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

  it('recognizes non-authenticated login state by visible login text after semantic logout', () => {
    const validation = useCase.logoutObservationValidation({
      url: 'https://app.local/',
      visibleTexts: ['Entrar', 'E-mail', 'Senha'],
      elements: [],
    });

    expect(validation.result.ok).toBe(true);
  });

  it('pre-satisfies authenticated area checks from current non-login app state', () => {
    expect(useCase.isTaskAlreadySatisfied(
      { title: 'Verificar área autenticada', expected: 'Área autenticada visível' },
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
      title: 'Trocar tema da aplicação',
      expected: 'Tema alterado',
      attempts: [{ actionType: 'click', result: 'FAILED', reason: 'Weak validation: expected_after_action does not prove the requested state change' }],
    }, 1);

    expect(context).toContain('Previous failed attempts');
    expect(context).toContain('Do not repeat the same weak action/validation');
    expect(context).toContain('For logout/sign-out tasks');
  });
});
