import { describe, expect, it } from 'vitest';

import { BugContextSchema } from '../src/domain/schemas/bug-context.schema.js';

const VALID_BUG_CONTEXT = {
  reproductionSteps: [
    'Abrir a tela de login',
    'Preencher credenciais inválidas',
    'Clicar em Entrar',
  ],
  expectedResult: 'Mensagem de erro de credenciais inválidas',
  actualResult: 'Tela em branco sem feedback',
};

describe('BugContextSchema', () => {
  it('accepts a valid bug context with all fields', () => {
    expect(BugContextSchema.parse(VALID_BUG_CONTEXT)).toEqual(VALID_BUG_CONTEXT);
  });

  it('defaults reproductionSteps to empty array when omitted', () => {
    const { reproductionSteps: _steps, ...withoutSteps } = VALID_BUG_CONTEXT;
    expect(BugContextSchema.parse(withoutSteps)).toEqual({
      ...withoutSteps,
      reproductionSteps: [],
    });
  });

  it('accepts expectedResult and actualResult as null', () => {
    expect(
      BugContextSchema.parse({
        ...VALID_BUG_CONTEXT,
        expectedResult: null,
        actualResult: null,
      }),
    ).toEqual({
      reproductionSteps: VALID_BUG_CONTEXT.reproductionSteps,
      expectedResult: null,
      actualResult: null,
    });
  });

  it('rejects empty reproduction step', () => {
    expect(() =>
      BugContextSchema.parse({
        ...VALID_BUG_CONTEXT,
        reproductionSteps: ['Valid step', ''],
      }),
    ).toThrow();
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      BugContextSchema.parse({
        ...VALID_BUG_CONTEXT,
        extraField: 'unexpected',
      }),
    ).toThrow();
  });
});
