import { describe, expect, it } from 'vitest';

import { FakeClickUpReaderAdapter } from '../src/infra/clickup/fake-clickup-reader.adapter.js';
import { ClickUpHttpReaderAdapter } from '../src/infra/clickup/clickup-http-reader.adapter.js';
import { DemandContextSchema } from '../src/domain/schemas/demand-context.schema.js';

const VALID_BUG_CONTEXT = {
  reproductionSteps: ['Abrir a página de login', 'Clicar em Entrar'],
  expectedResult: 'Usuário autenticado',
  actualResult: 'Erro 500',
};

describe('ClickUpReaderPort implementations', () => {
  it('FakeClickUpReaderAdapter mocks readTask for tests', async () => {
    const reader = new FakeClickUpReaderAdapter();
    const result = await reader.readTask('PRJ-11361', 'pk_test_token');

    expect(DemandContextSchema.parse(result.demand).taskId).toBe('PRJ-11361');
    expect(result.bug).toBeUndefined();
  });

  it('FakeClickUpReaderAdapter accepts configured demand and bug context', async () => {
    const demand = FakeClickUpReaderAdapter.defaultResult().demand;
    const reader = new FakeClickUpReaderAdapter({ demand, bug: VALID_BUG_CONTEXT });

    const result = await reader.readTask('PRJ-11362', 'pk_test_token');

    expect(result.demand).toEqual(demand);
    expect(result.bug).toEqual(VALID_BUG_CONTEXT);
  });

  it('ClickUpHttpReaderAdapter implements ClickUpReaderPort', () => {
    const reader: FakeClickUpReaderAdapter | ClickUpHttpReaderAdapter = new ClickUpHttpReaderAdapter();
    expect(typeof reader.readTask).toBe('function');
  });
});
