import { describe, expect, it } from 'vitest';

import { toFriendlyLlmErrorMessage } from '../src/infra/llm/llm-error-helper.js';

describe('toFriendlyLlmErrorMessage', () => {
  it('returns friendly message for 429', () => {
    const msg = toFriendlyLlmErrorMessage('Rate limited', 429);
    expect(msg).toContain('Limite de requisicoes atingido');
  });

  it('returns friendly message for 401', () => {
    const msg = toFriendlyLlmErrorMessage('Unauthorized', 401);
    expect(msg).toContain('Chave de API invalida');
  });

  it('returns friendly message for 500', () => {
    const msg = toFriendlyLlmErrorMessage('Server error', 500);
    expect(msg).toContain('temporariamente indisponivel');
  });

  it('returns friendly message for network errors', () => {
    const msg = toFriendlyLlmErrorMessage('fetch failed ETIMEDOUT', undefined);
    expect(msg).toContain('Nao foi possivel conectar');
  });

  it('returns generic message for unknown errors', () => {
    const msg = toFriendlyLlmErrorMessage('Something weird', undefined);
    expect(msg).toContain('Ocorreu um erro ao se comunicar');
    expect(msg).toContain('Something weird');
  });
});
