import { describe, expect, it } from 'vitest';

import {
  MemoryCandidateSchema,
  MemoryCandidateTypeSchema,
  MemoryCandidateStatusSchema,
  createMemoryCandidate,
} from '../src/domain/schemas/memory-candidate.schema.js';

describe('MemoryCandidateSchema', () => {
  const validCandidate = {
    id: 'mc-001',
    type: 'locator' as const,
    title: 'Login button locator',
    content: 'Button with text "Entrar" resolves to role=button name="Entrar"',
    sourceRunId: 'run-2024-001',
    confidence: 0.92,
    createdAt: '2024-05-29T10:00:00Z',
  };

  it('accepts a valid minimal candidate', () => {
    const parsed = MemoryCandidateSchema.parse(validCandidate);
    expect(parsed.id).toBe('mc-001');
    expect(parsed.type).toBe('locator');
    expect(parsed.confidence).toBe(0.92);
    expect(parsed.isConfirmed).toBe(false);
    expect(parsed.status).toBe('pending_review');
  });

  it('accepts a complete candidate with all optional fields', () => {
    const complete = {
      ...validCandidate,
      sourceScenarioId: 'scenario-001',
      sourceTaskId: 'T001',
      sourceStepId: 'step-1',
      isConfirmed: true,
      status: 'approved' as const,
      metadata: { project: 'meshamail', route: '/login' },
    };
    const parsed = MemoryCandidateSchema.parse(complete);
    expect(parsed.sourceScenarioId).toBe('scenario-001');
    expect(parsed.sourceTaskId).toBe('T001');
    expect(parsed.sourceStepId).toBe('step-1');
    expect(parsed.isConfirmed).toBe(true);
    expect(parsed.status).toBe('approved');
    expect(parsed.metadata).toEqual({ project: 'meshamail', route: '/login' });
  });

  it('rejects missing required fields', () => {
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, id: undefined })).toThrow();
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, type: undefined })).toThrow();
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, title: undefined })).toThrow();
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, content: undefined })).toThrow();
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, sourceRunId: undefined })).toThrow();
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, confidence: undefined })).toThrow();
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, createdAt: undefined })).toThrow();
  });

  it('rejects confidence outside 0-1 range', () => {
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, confidence: -0.1 })).toThrow();
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, confidence: 1.1 })).toThrow();
  });

  it('accepts boundary confidence values', () => {
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, confidence: 0 })).not.toThrow();
    expect(() => MemoryCandidateSchema.parse({ ...validCandidate, confidence: 1 })).not.toThrow();
  });

  it('rejects unknown fields due to strict mode', () => {
    expect(() =>
      MemoryCandidateSchema.parse({
        ...validCandidate,
        unknownField: 'should fail',
      }),
    ).toThrow();
  });

  it('validates all candidate types', () => {
    const types = ['locator', 'flow', 'known_issue', 'scenario_result'] as const;
    for (const type of types) {
      const parsed = MemoryCandidateSchema.parse({ ...validCandidate, type });
      expect(parsed.type).toBe(type);
    }
  });

  it('rejects invalid candidate type', () => {
    expect(() =>
      MemoryCandidateSchema.parse({ ...validCandidate, type: 'invalid_type' }),
    ).toThrow();
  });

  it('validates all statuses', () => {
    const statuses = ['pending_review', 'approved', 'rejected'] as const;
    for (const status of statuses) {
      const parsed = MemoryCandidateSchema.parse({ ...validCandidate, status });
      expect(parsed.status).toBe(status);
    }
  });

  it('rejects invalid status', () => {
    expect(() =>
      MemoryCandidateSchema.parse({ ...validCandidate, status: 'invalid_status' }),
    ).toThrow();
  });

  it('createMemoryCandidate helper returns a parsed candidate', () => {
    const candidate = createMemoryCandidate({
      id: 'mc-helper-001',
      type: 'flow',
      title: 'Login flow',
      content: 'Step-by-step login flow for meshamail',
      sourceRunId: 'run-2024-002',
      confidence: 0.85,
      createdAt: '2024-05-29T11:00:00Z',
    });
    expect(candidate.id).toBe('mc-helper-001');
    expect(candidate.type).toBe('flow');
    expect(candidate.isConfirmed).toBe(false);
    expect(candidate.status).toBe('pending_review');
  });
});

describe('MemoryCandidateTypeSchema', () => {
  it('accepts valid types', () => {
    expect(MemoryCandidateTypeSchema.parse('locator')).toBe('locator');
    expect(MemoryCandidateTypeSchema.parse('flow')).toBe('flow');
    expect(MemoryCandidateTypeSchema.parse('known_issue')).toBe('known_issue');
    expect(MemoryCandidateTypeSchema.parse('scenario_result')).toBe('scenario_result');
  });

  it('rejects invalid type', () => {
    expect(() => MemoryCandidateTypeSchema.parse('random')).toThrow();
  });
});

describe('MemoryCandidateStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(MemoryCandidateStatusSchema.parse('pending_review')).toBe('pending_review');
    expect(MemoryCandidateStatusSchema.parse('approved')).toBe('approved');
    expect(MemoryCandidateStatusSchema.parse('rejected')).toBe('rejected');
  });

  it('rejects invalid status', () => {
    expect(() => MemoryCandidateStatusSchema.parse('random')).toThrow();
  });
});
