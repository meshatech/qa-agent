import { describe, expect, it } from 'vitest';
import { DataHarnessService } from '../src/application/services/data-harness.service.js';

describe('DataHarnessService', () => {
  it('reuses generated values through ref', () => {
    const data = new DataHarnessService();
    const value = data.resolveObject('{{uniqueName:product:Produto}}');
    expect(data.resolveObject('{{ref:product}}')).toBe(value);
  });

  it('rejects missing refs', () => {
    const data = new DataHarnessService();
    expect(() => data.resolveObject('{{ref:missing}}')).toThrow(/missing/);
  });

  it('rejects generators in assertions', () => {
    const data = new DataHarnessService();
    expect(() => data.resolveObject('{{uniqueEmail:user}}', 'assertion')).toThrow(/not allowed/);
  });

  it('tolerates generator placeholders in assertions when the action already generated the key', () => {
    const data = new DataHarnessService();
    const email = data.resolveObject('{{uniqueEmail:user}}', 'action');
    expect(data.resolveObject('{{uniqueEmail:user}}', 'assertion')).toBe(email);
  });
});
