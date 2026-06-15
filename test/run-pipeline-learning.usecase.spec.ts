import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RunPipelineLearningUseCase } from '../src/application/use-cases/run-pipeline-learning.usecase.js';
import { LearningCandidateExtractorService } from '../src/application/services/learning-candidate-extractor.service.js';
import type { MemoryStorePort } from '../src/application/ports/memory-store.port.js';

function fakeMemoryStore(): MemoryStorePort {
  return {
    search: async () => ({ chunks: [], warnings: [] }),
    upsertPromoted: async () => ({ inserted: 0, updated: 0 }),
    findFailureFingerprint: async () => null,
    recordFailureFingerprint: async (input) => ({ ...input, lastSeenRunId: input.runId, firstSeenRunId: input.runId, occurrences: 1 }),
  };
}

const MOCK_CONFIG = {
  baseUrl: 'http://127.0.0.1:4173/',
  appDomains: ['127.0.0.1'],
  demand: { id: 'PRJ-TEST', title: 'Test', description: 'Test desc' },
  auth: { kind: 'none' as const },
  llm: { provider: 'fake' as const },
};

async function setupTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-learning-'));
  await writeFile(join(dir, 'agent-qa.config.json'), JSON.stringify(MOCK_CONFIG), 'utf8');
  await writeFile(join(dir, 'execution-plan.json'), JSON.stringify({
    schemaVersion: 'execution-plan.v1',
    planId: 'plan_test',
    version: 1,
    goal: 'Test',
    mode: 'HYBRID_GUARDED',
    runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
    steps: [
      {
        id: 'S001',
        scenarioId: 'SC-001',
        taskId: 'T001',
        description: 'Click login button',
        action: { type: 'click', target: { strategy: 'text', text: 'Login' } },
        postconditions: [],
        assertions: [],
      },
    ],
    assertions: [],
    metadata: { planSource: 'factory', fallbackReason: undefined },
  }), 'utf8');
  await writeFile(join(dir, 'execution-result.json'), JSON.stringify({
    ok: true,
    steps: [
      {
        stepId: 'S001',
        scenarioId: 'SC-001',
        taskId: 'T001',
        action: { type: 'click', target: { strategy: 'text', text: 'Login' } },
        resolvedAction: { type: 'click', targetElementId: 'btn_42', reason: 'click login' },
        boundExpected: { type: 'no_console_errors' },
        validation: { ok: true, type: 'no_console_errors', durationMs: 10 },
      },
    ],
    attempts: [{ actionType: 'click', result: 'PASSED', ts: '2024-01-01T00:00:00Z' }],
    warnings: [{ stepId: 'S001', message: 'Quiescence delay' }],
    locatorTelemetry: [
      { stepId: 'S001', type: 'deterministic_resolution', locatorStrategy: 'text', elementId: 'btn_42', timestamp: '2024-01-01T00:00:00Z' },
      { stepId: 'S001', type: 'semantic_fallback', locatorStrategy: 'semantic', elementId: 'el_123', timestamp: '2024-01-01T00:00:00Z' },
    ],
    patchHistory: [],
    evaluations: [
      { conditionId: 'S001:precondition:none', stepId: 'S001', phase: 'precondition', type: 'conditions', passed: true, severity: 'INFO', reason: 'conditions passed' },
      { conditionId: 'S001:postcondition:none', stepId: 'S001', phase: 'postcondition', type: 'conditions', passed: true, severity: 'INFO', reason: 'conditions passed' },
      { conditionId: 'S001:postcondition:1', stepId: 'S001', phase: 'postcondition', type: 'element_visible', passed: false, severity: 'ERROR', reason: 'not visible', expected: 'visible', actual: 'hidden' },
    ],
  }), 'utf8');
  await writeFile(join(dir, 'selected-scenarios.json'), JSON.stringify({
    schemaVersion: 'selected-scenarios.v1',
    scenarios: [
      {
        id: 'SC-001',
        title: 'Login flow',
        tasks: [
          {
            id: 'T001',
            title: 'Login',
            expected: 'User logs in',
            expectedOutcome: { kind: 'navigation', description: 'Navigate to dashboard', target: 'dashboard' },
          },
        ],
      },
    ],
  }), 'utf8');
  await writeFile(join(dir, 'memory-consultation-log.json'), JSON.stringify({
    entries: [
      { query: 'login button', chunks: [{ id: 'c1', type: 'semantic_locator', title: 'Login', score: 0.9 }], used: true },
      { query: 'logout link', chunks: [], used: false },
    ],
  }), 'utf8');
  return dir;
}

describe('RunPipelineLearningUseCase', () => {
  it('generates learning candidates from artifacts', async () => {
    const dir = await setupTempDir();

    const useCase = new RunPipelineLearningUseCase(
      new LearningCandidateExtractorService(),
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      fakeMemoryStore(),
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.candidatesPath).toBeDefined();
    expect(result.count).toBeGreaterThan(0);
    expect(result.confirmedCount).toBeGreaterThanOrEqual(0);
    expect(result.inferredCount).toBeGreaterThanOrEqual(0);
    expect(result.semanticLocatorSuggestions).toBeGreaterThanOrEqual(0);
    // Verify no ephemeral IDs are persisted as stable locators
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(result.candidatesPath, 'utf8');
    const artifact = JSON.parse(content);
    expect(artifact.schemaVersion).toBe('learning-candidates.v1');
    expect(artifact.count).toBe(result.count);
    expect(artifact.candidates).toBeInstanceOf(Array);

    for (const candidate of artifact.candidates) {
      if (candidate.metadata?.elementId) {
        expect(candidate.metadata.elementId).not.toMatch(/^el_\d{3,}$/);
      }
    }

    // Verify traceability
    for (const candidate of artifact.candidates) {
      expect(candidate.runId).toBeDefined();
      expect(candidate.id).toBeDefined();
      expect(candidate.type).toBeDefined();
      expect(candidate.confidence).toBeGreaterThanOrEqual(0);
      expect(candidate.confidence).toBeLessThanOrEqual(1);
    }

    await rm(dir, { recursive: true, force: true });
  });

  it('produces zero candidates when artifacts are missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-learning-empty-'));
    await writeFile(join(dir, 'agent-qa.config.json'), JSON.stringify(MOCK_CONFIG), 'utf8');

    const useCase = new RunPipelineLearningUseCase(
      new LearningCandidateExtractorService(),
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      fakeMemoryStore(),
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.count).toBe(0);
    expect(result.confirmedCount).toBe(0);
    expect(result.inferredCount).toBe(0);
    expect(result.gapCount).toBe(0);

    await rm(dir, { recursive: true, force: true });
  });
});
