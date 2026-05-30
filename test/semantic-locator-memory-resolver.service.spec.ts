import { describe, expect, it } from 'vitest';
import { SemanticLocatorMemoryResolverService } from '../src/application/services/semantic-locator-memory-resolver.service.js';
import type { MemorySearchService } from '../src/application/services/memory-search.service.js';
import type { ExpectedOutcome } from '../src/domain/schemas/expected-outcome.schema.js';

describe('SemanticLocatorMemoryResolverService', () => {
  it('returns empty array when memory search yields no results', async () => {
    const stubSearch: MemorySearchService = {
      async search() {
        return { chunks: [], warnings: [] };
      },
    } as unknown as MemorySearchService;

    const resolver = new SemanticLocatorMemoryResolverService(stubSearch);
    const outcome: ExpectedOutcome = { kind: 'DEAUTHENTICATION', description: 'usuario encerra sessao' };
    const candidates = await resolver.resolveCandidates(outcome);

    expect(candidates).toEqual([]);
  });

  it('extracts quoted and bold texts from memory chunks', async () => {
    const stubSearch: MemorySearchService = {
      async search() {
        return {
          chunks: [
            {
              chunk: {
                id: 'LOC-001',
                type: 'semantic_locator',
                title: 'Logout button',
                content: '- label: "Sair"\n- also known as: **Logout** or **Sign out**',
                sourceFile: 'memory.md',
              },
              relevanceScore: 1.0,
            },
          ],
          warnings: [],
        };
      },
    } as unknown as MemorySearchService;

    const resolver = new SemanticLocatorMemoryResolverService(stubSearch);
    const outcome: ExpectedOutcome = { kind: 'DEAUTHENTICATION', description: 'usuario encerra sessao' };
    const candidates = await resolver.resolveCandidates(outcome);

    expect(candidates).toContain('Sair');
    expect(candidates).toContain('Logout');
    expect(candidates).toContain('Sign out');
    expect(candidates).toContain('Logout button');
  });

  it('uses target in query when present', async () => {
    let capturedQuery = '';
    const stubSearch: MemorySearchService = {
      async search(input: { query: string; limit: number; types?: string[]; projectPath?: string; memoryPath?: string }) {
        capturedQuery = input.query;
        return { chunks: [], warnings: [] };
      },
    } as unknown as MemorySearchService;

    const resolver = new SemanticLocatorMemoryResolverService(stubSearch);
    const outcome: ExpectedOutcome = { kind: 'NAVIGATION', target: '/dashboard', description: 'acessar dashboard' };
    await resolver.resolveCandidates(outcome);

    expect(capturedQuery).toContain('acessar dashboard');
    expect(capturedQuery).toContain('/dashboard');
  });

  it('returns empty array when memory search throws', async () => {
    const stubSearch: MemorySearchService = {
      async search() {
        throw new Error('search unavailable');
      },
    } as unknown as MemorySearchService;

    const resolver = new SemanticLocatorMemoryResolverService(stubSearch);
    const outcome: ExpectedOutcome = { kind: 'DEAUTHENTICATION', description: 'usuario encerra sessao' };
    await expect(resolver.resolveCandidates(outcome)).rejects.toThrow('search unavailable');
  });

  it('returns only title when chunk content has no quotes or bold', async () => {
    const stubSearch: MemorySearchService = {
      async search() {
        return {
          chunks: [
            {
              chunk: {
                id: 'LOC-002',
                type: 'semantic_locator',
                title: 'Plain title',
                content: 'Just plain text without any markdown formatting',
                sourceFile: 'memory.md',
              },
              relevanceScore: 0.8,
            },
          ],
          warnings: [],
        };
      },
    } as unknown as MemorySearchService;

    const resolver = new SemanticLocatorMemoryResolverService(stubSearch);
    const outcome: ExpectedOutcome = { kind: 'DISCLOSURE', description: 'open menu' };
    const candidates = await resolver.resolveCandidates(outcome);

    expect(candidates).toEqual(['Plain title']);
  });

  it('uses description as query when outcome has no target', async () => {
    let capturedQuery = '';
    const stubSearch: MemorySearchService = {
      async search(input: { query: string; limit: number; types?: string[]; projectPath?: string; memoryPath?: string }) {
        capturedQuery = input.query;
        return { chunks: [], warnings: [] };
      },
    } as unknown as MemorySearchService;

    const resolver = new SemanticLocatorMemoryResolverService(stubSearch);
    const outcome: ExpectedOutcome = { kind: 'DEAUTHENTICATION', description: 'logout action' };
    await resolver.resolveCandidates(outcome);

    expect(capturedQuery).toBe('logout action');
    expect(capturedQuery).not.toContain('undefined');
  });

  it('deduplicates candidates across multiple chunks', async () => {
    const stubSearch: MemorySearchService = {
      async search() {
        return {
          chunks: [
            {
              chunk: {
                id: 'LOC-003',
                type: 'semantic_locator',
                title: 'Save button',
                content: '- label: "Save"\n- also known as: **Save**',
                sourceFile: 'memory.md',
              },
              relevanceScore: 0.9,
            },
            {
              chunk: {
                id: 'LOC-004',
                type: 'semantic_locator',
                title: 'Save button',
                content: '- label: "Save"',
                sourceFile: 'memory.md',
              },
              relevanceScore: 0.7,
            },
          ],
          warnings: [],
        };
      },
    } as unknown as MemorySearchService;

    const resolver = new SemanticLocatorMemoryResolverService(stubSearch);
    const outcome: ExpectedOutcome = { kind: 'DISCLOSURE', description: 'save' };
    const candidates = await resolver.resolveCandidates(outcome);

    expect(candidates).toEqual(['Save button', 'Save']);
  });
});
