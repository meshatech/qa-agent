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

  it('redacts URL-encoded secret variants', () => {
    const token = 'pk_super_secret_token_value';
    const encoded = encodeURIComponent(token);
    const message = `Authorization query failed: ?Authorization=${encoded}`;

    expect(redactSecretsInMessage(message, [token])).toBe(
      `Authorization query failed: ?Authorization=${SECRET_REDACTION_MASK}`,
    );
    expect(redactSecretsInMessage(message, [token])).not.toContain(token);
    expect(redactSecretsInMessage(message, [token])).not.toContain(encoded);
  });

  it('redacts base64-encoded secret variants', () => {
    const token = 'pk_super_secret_token_value';
    const encoded = Buffer.from(token, 'utf8').toString('base64');
    const message = `Header value ${encoded} rejected`;

    expect(redactSecretsInMessage(message, [token])).toBe(
      `Header value ${SECRET_REDACTION_MASK} rejected`,
    );
    expect(redactSecretsInMessage(message, [token])).not.toContain(encoded);
  });

  it('redacts literal, URL-encoded, and base64 variants in the same message', () => {
    const token = 'pk_super_secret_token_value';
    const urlEncoded = encodeURIComponent(token);
    const base64 = Buffer.from(token, 'utf8').toString('base64');
    const message = `literal=${token} url=${urlEncoded} b64=${base64}`;

    const redacted = redactSecretsInMessage(message, [token]);

    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain(urlEncoded);
    expect(redacted).not.toContain(base64);
    expect(redacted.split(SECRET_REDACTION_MASK)).toHaveLength(4);
  });
});
