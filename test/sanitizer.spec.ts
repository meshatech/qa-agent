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
});
