import { describe, expect, it } from 'vitest';

import { collectKnownSecretsFromEnv } from '../src/application/services/known-secrets.collector.js';

describe('collectKnownSecretsFromEnv', () => {
  it('collects CLICKUP_TOKEN, CLICKUP_TASK_ID, and GitHub tokens from env', () => {
    const secrets = collectKnownSecretsFromEnv({
      CLICKUP_TOKEN: 'pk_live_token',
      CLICKUP_TASK_ID: 'PRJ-12345',
      GITHUB_TOKEN: 'ghp_abc',
    });

    expect(secrets).toEqual(expect.arrayContaining(['pk_live_token', 'PRJ-12345', 'ghp_abc']));
    expect(secrets).toHaveLength(3);
  });

  it('includes extra secrets and skips empty values', () => {
    const secrets = collectKnownSecretsFromEnv(
      { CLICKUP_TOKEN: '  ', CLICKUP_TASK_ID: 'PRJ-999' },
      ['custom-secret'],
    );

    expect(secrets).toEqual(['PRJ-999', 'custom-secret']);
  });
});
