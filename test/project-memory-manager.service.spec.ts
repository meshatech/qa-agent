import { describe, expect, it, vi } from 'vitest';

import {
  ProjectMemoryManagerService,
  mergeKnowledge,
} from '../src/application/services/project-memory-manager.service.js';
import { ProjectKnowledgeSchema, type ProjectKnowledge } from '../src/domain/schemas/project-knowledge.schema.js';

function knowledge(analyzedAt: string, over: Partial<ProjectKnowledge> = {}): ProjectKnowledge {
  return ProjectKnowledgeSchema.parse({
    metadata: { repo: 'meshatech/kriya-web', branch: 'release', analyzedAt, confidence: 'high' },
    auth: { kind: 'none' },
    ...over,
  });
}

const analysisInput = {
  repo: 'meshatech/kriya-web',
  branch: 'release',
  projectPath: process.cwd(),
  changedFiles: [],
  affectedRoutes: [],
};

describe('ProjectMemoryManagerService.resolve', () => {
  it('reuses fresh stored knowledge without analyzing', async () => {
    const stored = knowledge(new Date().toISOString());
    const store = { load: vi.fn().mockResolvedValue(stored), save: vi.fn() };
    const analysis = { analyze: vi.fn() };
    const manager = new ProjectMemoryManagerService(store as never, analysis as never);

    const result = await manager.resolve(analysisInput);

    expect(result.fromMemory).toBe(true);
    expect(result.analyzed).toBe(false);
    expect(analysis.analyze).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('analyzes and saves when no knowledge exists', async () => {
    const fresh = knowledge(new Date().toISOString());
    const store = { load: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const analysis = { analyze: vi.fn().mockResolvedValue(fresh) };
    const manager = new ProjectMemoryManagerService(store as never, analysis as never);

    const result = await manager.resolve(analysisInput);

    expect(result.analyzed).toBe(true);
    expect(result.fromMemory).toBe(false);
    expect(analysis.analyze).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledOnce();
  });

  it('re-analyzes and merges when stored knowledge is stale', async () => {
    const stale = knowledge(new Date(Date.now() - 40 * 864e5).toISOString(), { businessRules: ['BR-old'] });
    const fresh = knowledge(new Date().toISOString(), { businessRules: ['BR-new'] });
    const store = { load: vi.fn().mockResolvedValue(stale), save: vi.fn() };
    const analysis = { analyze: vi.fn().mockResolvedValue(fresh) };
    const manager = new ProjectMemoryManagerService(store as never, analysis as never);

    const result = await manager.resolve(analysisInput);

    expect(result.analyzed).toBe(true);
    expect(result.knowledge.businessRules).toEqual(expect.arrayContaining(['BR-old', 'BR-new']));
    expect(store.save).toHaveBeenCalledOnce();
  });
});

describe('mergeKnowledge', () => {
  it('unions arrays and keeps existing auth when fresh is unknown', () => {
    const existing = knowledge(new Date().toISOString(), {
      auth: { kind: 'formLogin', loginUrl: '/login' },
      uiPatterns: ['modal close top-right'],
    });
    const fresh = knowledge(new Date().toISOString(), {
      auth: { kind: 'unknown' },
      uiPatterns: ['toast top-right'],
    });

    const merged = mergeKnowledge(existing, fresh);

    expect(merged.auth.kind).toBe('formLogin');
    expect(merged.uiPatterns).toEqual(expect.arrayContaining(['modal close top-right', 'toast top-right']));
  });
});
