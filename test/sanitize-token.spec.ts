import { describe, expect, it } from 'vitest';

import {
  redactSecretsInMessage,
  sanitizeToken,
  SECRET_REDACTION_MASK,
} from '../src/application/helpers/sanitize-token.js';

describe('sanitizeToken', () => {
  it('returns masked placeholder for short tokens', () => {
    expect(sanitizeToken('pk_test')).toBe('****');
    expect(sanitizeToken('  abcd    ')).toBe('****');
  });

  it('returns first and last four characters for longer tokens', () => {
    expect(sanitizeToken('pk_abcdefghijklmnop')).toBe('pk_a...mnop');
  });
});

describe('redactSecretsInMessage', () => {
  it('replaces known secret literals in the message', () => {
    const token = 'pk_super_secret_token_value';
    const message = `Request failed with token ${token} in header`;

    expect(redactSecretsInMessage(message, [token])).toBe(
      `Request failed with token ${SECRET_REDACTION_MASK} in header`,
    );
  });

  it('ignores empty secrets', () => {
    expect(redactSecretsInMessage('unchanged', ['', '   '])).toBe('unchanged');
  });
});
