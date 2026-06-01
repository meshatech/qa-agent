import { describe, expect, it } from 'vitest';
import { ValueGeneratorService } from '../src/application/services/value-generator.service.js';

const service = new ValueGeneratorService();

function makeOutcome(kind: 'DATA_ENTRY' = 'DATA_ENTRY') {
  return { kind, description: 'test' } as const;
}

describe('ValueGeneratorService', () => {
  it('generates email for email-related task titles', () => {
    expect(service.generate('enter email', makeOutcome())).toBe('test@example.com');
    expect(service.generate('fill e-mail', makeOutcome())).toBe('test@example.com');
    expect(service.generate('correio eletronico', makeOutcome())).toBe('test@example.com');
    expect(service.generate('mail field', makeOutcome())).toBe('test@example.com');
  });

  it('generates password for password-related task titles', () => {
    expect(service.generate('enter password', makeOutcome())).toBe('Test@123456');
    expect(service.generate('fill senha', makeOutcome())).toBe('Test@123456');
    expect(service.generate('passphrase', makeOutcome())).toBe('Test@123456');
    expect(service.generate('passwd field', makeOutcome())).toBe('Test@123456');
  });

  it('falls back to safe-test-value for generic tasks', () => {
    expect(service.generate('fill name', makeOutcome())).toBe('safe-test-value');
    expect(service.generate('click button', makeOutcome())).toBe('safe-test-value');
    expect(service.generate('check box', makeOutcome())).toBe('safe-test-value');
  });

  it('uses an explicit quoted literal from the task contract', () => {
    expect(service.generate('enter text', { kind: 'DATA_ENTRY', description: "type 'teste' in the editor" })).toBe('teste');
  });

  it.each([
    { title: '', expected: 'safe-test-value' },
    { title: ' ', expected: 'safe-test-value' },
    { title: '12345', expected: 'safe-test-value' },
    { title: '日本語', expected: 'safe-test-value' },
    { title: 'العربية', expected: 'safe-test-value' },
    { title: '!!!@@@###', expected: 'safe-test-value' },
    { title: 'a very long task title that exceeds normal length and contains many words', expected: 'safe-test-value' },
  ])('returns safe-test-value for atypical title "$title"', ({ title, expected }) => {
    expect(service.generate(title, makeOutcome())).toBe(expected);
  });
});
