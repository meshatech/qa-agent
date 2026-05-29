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
});
