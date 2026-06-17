import { describe, expect, it } from 'vitest';

import {
  ProjectKnowledgeSchema,
  isProjectKnowledgeStale,
  PROJECT_KNOWLEDGE_SCHEMA_VERSION,
} from '../src/domain/schemas/project-knowledge.schema.js';

function metadata(analyzedAt: string) {
  return { repo: 'meshatech/kriya-web', branch: 'release', analyzedAt };
}

describe('ProjectKnowledgeSchema', () => {
  it('applies defaults for a minimal knowledge', () => {
    const parsed = ProjectKnowledgeSchema.parse({ metadata: metadata(new Date().toISOString()) });
    expect(parsed.schemaVersion).toBe(PROJECT_KNOWLEDGE_SCHEMA_VERSION);
    expect(parsed.auth.kind).toBe('unknown');
    expect(parsed.metadata.confidence).toBe('low');
    expect(parsed.allModules).toEqual([]);
    expect(parsed.consoleNoisePatterns).toEqual([]);
  });

  it('parses a rich knowledge with auth selectors and modules', () => {
    const parsed = ProjectKnowledgeSchema.parse({
      metadata: { ...metadata(new Date().toISOString()), confidence: 'high' },
      auth: {
        kind: 'formLogin',
        loginUrl: '/login',
        loginModule: 'src/modules/auth/',
        selectors: { username: 'input[name="email"]', password: 'input[name="password"]', submit: 'button[type="submit"]' },
      },
      modulesRequiringAuth: [{ name: 'Dashboard', route: '/dashboard', requiresAuth: true }],
      consoleNoisePatterns: ['omnitagjs.com'],
    });
    expect(parsed.auth.kind).toBe('formLogin');
    expect(parsed.modulesRequiringAuth[0]?.route).toBe('/dashboard');
  });
});

describe('isProjectKnowledgeStale', () => {
  it('is fresh when analyzed recently', () => {
    expect(isProjectKnowledgeStale({ metadata: metadata(new Date().toISOString()) })).toBe(false);
  });

  it('is stale beyond 30 days', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    expect(isProjectKnowledgeStale({ metadata: metadata(old) })).toBe(true);
  });

  it('is stale when analyzedAt is unparseable', () => {
    expect(isProjectKnowledgeStale({ metadata: metadata('not-a-date') })).toBe(true);
  });
});
