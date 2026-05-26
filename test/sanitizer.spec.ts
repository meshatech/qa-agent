import { describe, expect, it } from 'vitest';
import { SanitizerService } from '../src/application/services/sanitizer.service.js';

describe('SanitizerService', () => {
  it('redacts secret keys and sensitive strings', () => {
    const value = new SanitizerService().sanitize({
      apiKey: 'abc',
      message: 'Bearer token123 user@example.com',
    });
    expect(value.apiKey).toBe('***REDACTED***');
    expect(value.message).toContain('***REDACTED***');
  });

  it('masks Authorization Bearer headers in strings', () => {
    const value = new SanitizerService().sanitize('Authorization: Bearer ghp_abc1234567890');
    expect(value).toContain('***REDACTED***');
    expect(value).not.toContain('ghp_abc1234567890');
  });

  it('masks common ClickUp and GitHub token patterns', () => {
    const sanitizer = new SanitizerService();
    expect(sanitizer.sanitize('failed with pk_live_secretvalue123')).toContain('***REDACTED***');
    expect(sanitizer.sanitize('failed with ghp_test_secretvalue123')).toContain('***REDACTED***');
  });

  it('sanitizeForOutput removes known secret literals from nested objects', () => {
    const secret = 'pk_x_custom_secret';
    const value = new SanitizerService().sanitizeForOutput(
      { error: `Auth failed for token ${secret}` },
      [secret],
    );
    expect(value.error).toContain('***REDACTED***');
    expect(value.error).not.toContain(secret);
  });

  it('containsLeakedSecrets detects known secrets and sensitive patterns', () => {
    const sanitizer = new SanitizerService();
    const secret = 'pk_test_leak_detector_secret';
    expect(sanitizer.containsLeakedSecrets(`failed with ${secret}`, [secret])).toBe(true);
    expect(sanitizer.containsLeakedSecrets('Authorization: Bearer ghp_abc1234567890', [])).toBe(true);
    expect(sanitizer.containsLeakedSecrets('safe message only', [])).toBe(false);
  });
});
