import { describe, expect, it } from 'vitest';

import { StateContractTranslatorService } from '../src/application/services/state-contract-translator.service.js';
import type { ExpectedOutcome } from '../src/domain/schemas/expected-outcome.schema.js';

describe('StateContractTranslatorService', () => {
  const translator = new StateContractTranslatorService();

  const outcome = (o: Partial<ExpectedOutcome> & Pick<ExpectedOutcome, 'kind'>): ExpectedOutcome => ({
    description: 'test outcome',
    ...o,
  });

  it('AUTHENTICATION -> auth_state authenticated', () => {
    const result = translator.toPostconditions(outcome({ kind: 'AUTHENTICATION' }));
    expect(result).toEqual([{ type: 'auth_state', expected: 'authenticated' }]);
  });

  it('DEAUTHENTICATION -> auth_state anonymous', () => {
    const result = translator.toPostconditions(outcome({ kind: 'DEAUTHENTICATION' }));
    expect(result).toEqual([{ type: 'auth_state', expected: 'anonymous' }]);
  });

  it('NAVIGATION with target -> route_state matches expectedUrlPattern', () => {
    const result = translator.toPostconditions(outcome({ kind: 'NAVIGATION', target: '/login' }));
    expect(result).toEqual([{ type: 'route_state', expected: 'matches', expectedUrlPattern: '/login' }]);
  });

  it('NAVIGATION without target -> route_state changed', () => {
    const result = translator.toPostconditions(outcome({ kind: 'NAVIGATION' }));
    expect(result).toEqual([{ type: 'route_state', expected: 'changed' }]);
  });

  it('APPEARANCE_CHANGE -> ui_state changed with target semanticKey', () => {
    const result = translator.toPostconditions(outcome({ kind: 'APPEARANCE_CHANGE', target: 'theme_mode' }));
    expect(result).toEqual([{ type: 'ui_state', semanticKey: 'theme_mode', expected: 'exists', source: 'dom' }]);
  });

  it('APPEARANCE_CHANGE without target -> defaults semanticKey appearance_mode', () => {
    const result = translator.toPostconditions(outcome({ kind: 'APPEARANCE_CHANGE' }));
    expect(result).toEqual([{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'exists', source: 'dom' }]);
  });

  it('DISCLOSURE -> menu_state open with target semanticKey', () => {
    const result = translator.toPostconditions(outcome({ kind: 'DISCLOSURE', target: 'account_menu' }));
    expect(result).toEqual([{ type: 'menu_state', semanticKey: 'account_menu', expected: 'open' }]);
  });

  it('DISCLOSURE without target -> defaults semanticKey menu', () => {
    const result = translator.toPostconditions(outcome({ kind: 'DISCLOSURE' }));
    expect(result).toEqual([{ type: 'menu_state', semanticKey: 'menu', expected: 'open' }]);
  });

  it('CONTENT_PRESENCE with target -> text_visible', () => {
    const result = translator.toPostconditions(outcome({ kind: 'CONTENT_PRESENCE', target: 'Caixa de entrada' }));
    expect(result).toEqual([{ type: 'text_visible', text: 'Caixa de entrada' }]);
  });

  it('CONTENT_PRESENCE without target -> no_console_errors safety', () => {
    const result = translator.toPostconditions(outcome({ kind: 'CONTENT_PRESENCE' }));
    expect(result).toEqual([{ type: 'no_console_errors' }]);
  });

  it('DATA_ENTRY -> no_console_errors safety', () => {
    const result = translator.toPostconditions(outcome({ kind: 'DATA_ENTRY' }));
    expect(result).toEqual([{ type: 'no_console_errors' }]);
  });

  it('NO_REGRESSION -> no_console_errors', () => {
    const result = translator.toPostconditions(outcome({ kind: 'NO_REGRESSION' }));
    expect(result).toEqual([{ type: 'no_console_errors' }]);
  });

  it('does not inspect description text to decide conditions', () => {
    // Description mentions "logout"/"sair" but kind is NAVIGATION; result must
    // follow the typed kind, never the words.
    const result = translator.toPostconditions(
      outcome({ kind: 'NAVIGATION', target: '/dashboard', description: 'usuario faz logout e sai da conta' }),
    );
    expect(result).toEqual([{ type: 'route_state', expected: 'matches', expectedUrlPattern: '/dashboard' }]);
  });
});
