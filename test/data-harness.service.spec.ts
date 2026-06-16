import { describe, expect, it, beforeEach } from 'vitest';
import { DataHarnessService } from '../src/application/services/data-harness.service.js';
import { DomainError } from '../src/domain/shared/result.js';

describe('DataHarnessService', () => {
  const service = new DataHarnessService();

  beforeEach(() => {
    service.reset();
  });

  it('stores and resolves ref values', () => {
    service.storeValue('name', 'Joao');
    const result = service.resolveObject('Hello {{ref:name}}', 'action');
    expect(result).toBe('Hello Joao');
  });

  it('generates uniqueName with suffix', () => {
    const result = service.resolveObject('{{uniqueName:client:Test Client}}', 'action');
    expect(result).toMatch(/Test Client \d+-[a-f0-9]+/);
  });

  it('generates uniqueEmail with suffix', () => {
    const result = service.resolveObject('{{uniqueEmail:client}}', 'action');
    expect(result).toMatch(/client\.\d+-[a-f0-9]+@qa\.local/);
  });

  it('throws when ref is used in assertion before generation', () => {
    expect(() => service.resolveObject('{{uniqueName:client}}', 'assertion')).toThrow(DomainError);
  });

  it('throws when ref key not found', () => {
    expect(() => service.resolveObject('{{ref:missing}}', 'action')).toThrow(DomainError);
  });

  it('resolves nested objects recursively', () => {
    service.storeValue('id', '123');
    const input = { name: 'Item {{ref:id}}', nested: { value: 'Val {{ref:id}}' } };
    const result = service.resolveObject(input, 'action');
    expect(result).toEqual({ name: 'Item 123', nested: { value: 'Val 123' } });
  });

  it('resolves arrays recursively', () => {
    service.storeValue('x', 'A');
    const input = ['{{ref:x}}', '{{ref:x}}'];
    const result = service.resolveObject(input, 'action');
    expect(result).toEqual(['A', 'A']);
  });

  it('returns all stored values', () => {
    service.storeValue('a', '1');
    service.storeValue('b', '2');
    expect(service.all()).toEqual({ a: '1', b: '2' });
  });

  it('clears store on reset', () => {
    service.storeValue('key', 'val');
    service.reset();
    expect(() => service.resolveObject('{{ref:key}}', 'action')).toThrow(DomainError);
  });
});
