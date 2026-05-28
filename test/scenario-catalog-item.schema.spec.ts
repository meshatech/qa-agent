import { describe, expect, it } from 'vitest';

import {
  ScenarioCatalogItemSchema,
  validateScenarioCatalogItem,
} from '../src/domain/schemas/scenario-catalog-item.schema.js';

describe('ScenarioCatalogItemSchema', () => {
  it('parses valid item with all required fields', () => {
    const input = {
      id: 'SCN-LOGIN-001',
      title: 'Login autenticado',
      source: 'memory',
    };

    const result = validateScenarioCatalogItem(input);

    expect(result.id).toBe('SCN-LOGIN-001');
    expect(result.title).toBe('Login autenticado');
    expect(result.source).toBe('memory');
    expect(result.description).toBeUndefined();
    expect(result.route).toBeUndefined();
  });

  it('parses item with all optional fields', () => {
    const input = {
      id: 'SCN-LOGOUT-001',
      title: 'Logout do sistema',
      description: 'Usuario clica em sair e volta para login',
      route: '/login',
      component: 'LogoutButton',
      criteria: ['Redireciona para /login', 'Sessao encerrada'],
      tags: ['auth', 'logout'],
      priority: 'HIGH',
      source: 'catalog',
      memoryChunkId: 'CHUNK-001',
      createdAt: '2026-05-27T12:00:00Z',
      updatedAt: '2026-05-27T12:00:00Z',
    };

    const result = validateScenarioCatalogItem(input);

    expect(result.id).toBe('SCN-LOGOUT-001');
    expect(result.title).toBe('Logout do sistema');
    expect(result.description).toBe('Usuario clica em sair e volta para login');
    expect(result.route).toBe('/login');
    expect(result.component).toBe('LogoutButton');
    expect(result.criteria).toEqual(['Redireciona para /login', 'Sessao encerrada']);
    expect(result.tags).toEqual(['auth', 'logout']);
    expect(result.priority).toBe('HIGH');
    expect(result.source).toBe('catalog');
    expect(result.memoryChunkId).toBe('CHUNK-001');
    expect(result.createdAt).toBe('2026-05-27T12:00:00Z');
    expect(result.updatedAt).toBe('2026-05-27T12:00:00Z');
  });

  it('parses item with scenario payload', () => {
    const input = {
      id: 'SCN-001',
      title: 'Teste',
      source: 'generated',
      scenario: {
        id: 'scenario-001',
        title: 'Teste',
        status: 'PLANNED',
        tasks: [{ id: 'T001', title: 'Task', expected: 'Ok', status: 'PENDING' }],
      },
    };

    const result = validateScenarioCatalogItem(input);

    expect(result.id).toBe('SCN-001');
    expect(result.scenario).toBeDefined();
  });

  it('throws on missing id', () => {
    expect(() =>
      validateScenarioCatalogItem({
        title: 'Teste',
        source: 'memory',
      }),
    ).toThrow();
  });

  it('throws on empty id', () => {
    expect(() =>
      validateScenarioCatalogItem({
        id: '',
        title: 'Teste',
        source: 'memory',
      }),
    ).toThrow();
  });

  it('throws on missing title', () => {
    expect(() =>
      validateScenarioCatalogItem({
        id: 'SCN-001',
        source: 'memory',
      }),
    ).toThrow();
  });

  it('throws on empty title', () => {
    expect(() =>
      validateScenarioCatalogItem({
        id: 'SCN-001',
        title: '',
        source: 'memory',
      }),
    ).toThrow();
  });

  it('throws on invalid source', () => {
    expect(() =>
      validateScenarioCatalogItem({
        id: 'SCN-001',
        title: 'Teste',
        source: 'invalid',
      }),
    ).toThrow();
  });

  it('throws on invalid priority', () => {
    expect(() =>
      validateScenarioCatalogItem({
        id: 'SCN-001',
        title: 'Teste',
        source: 'memory',
        priority: 'URGENT',
      }),
    ).toThrow();
  });

  it('throws on unknown extra fields (strict mode)', () => {
    expect(() =>
      validateScenarioCatalogItem({
        id: 'SCN-001',
        title: 'Teste',
        source: 'memory',
        extraField: 'not allowed',
      }),
    ).toThrow();
  });

  it('accepts all valid source values', () => {
    const sources = ['memory', 'catalog', 'generated', 'manual'];
    for (const source of sources) {
      const result = validateScenarioCatalogItem({
        id: `SCN-${source}`,
        title: `Test ${source}`,
        source: source as 'memory',
      });
      expect(result.source).toBe(source);
    }
  });

  it('accepts all valid priority values', () => {
    const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    for (const priority of priorities) {
      const result = validateScenarioCatalogItem({
        id: `SCN-${priority}`,
        title: `Test ${priority}`,
        source: 'memory',
        priority: priority as 'LOW',
      });
      expect(result.priority).toBe(priority);
    }
  });
});
