import { describe, expect, it } from 'vitest';

import { LearningExtractorService } from '../src/application/services/learning-extractor.service.js';
import type { QaRunResult, QaStep } from '../src/domain/models/run.model.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

describe('LearningExtractorService', () => {
  const service = new LearningExtractorService();

  const makeStep = (overrides: Partial<QaStep> & { stepId: string }): QaStep => ({
    stepId: overrides.stepId,
    scenarioId: overrides.scenarioId ?? 'scenario-001',
    taskId: overrides.taskId ?? 'T001',
    observationId: overrides.observationId ?? 'obs-001',
    thoughtSummary: overrides.thoughtSummary ?? 'Click login button',
    action: overrides.action ?? { type: 'click', targetElementId: 'el_001', reason: 'test' },
    resolvedAction: overrides.resolvedAction ?? { type: 'click', targetElementId: 'el_001', reason: 'test' },
    boundExpected: overrides.boundExpected ?? { type: 'no_console_errors' },
    validation: overrides.validation ?? { ok: true, type: 'no_console_errors', durationMs: 0 },
    ...overrides,
  });

  const makeConfig = (): RunConfig =>
    ({
      baseUrl: 'https://example.com',
      appDomains: ['example.com'],
      demand: { id: 'demand-001', title: 'Test', description: 'Test demand' },
    } as unknown as RunConfig);

  it('returns empty array when no steps or scenarios', () => {
    const result: QaRunResult = {
      status: 'PASSED',
      runDir: '/tmp/run-001',
      steps: [],
    };
    const candidates = service.extract(result, makeConfig());
    expect(candidates).toHaveLength(0);
  });

  it('extracts locator candidate from successful click step', () => {
    const step = makeStep({
      stepId: 'step-001',
      thoughtSummary: 'Click login button',
      resolvedAction: { type: 'click', targetElementId: 'el_001', reason: 'login' },
      validation: { ok: true, type: 'no_console_errors', durationMs: 100 },
    });
    const result: QaRunResult = {
      status: 'PASSED',
      runDir: '/tmp/run-001',
      steps: [step],
      finishedAt: '2024-05-29T10:00:00Z',
    };
    const candidates = service.extract(result, makeConfig());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('locator');
    expect(candidates[0].confidence).toBe(0.9);
    expect(candidates[0].title).toContain('Locator succeeded');
  });

  it('extracts known_issue candidate from failed click step', () => {
    const step = makeStep({
      stepId: 'step-002',
      thoughtSummary: 'Click broken button',
      resolvedAction: { type: 'click', targetElementId: 'el_002', reason: 'test' },
      validation: { ok: false, type: 'no_console_errors', actual: 'Error', durationMs: 0 },
      error: { code: 'LOCATOR_NOT_FOUND', message: 'Element not found' },
    });
    const result: QaRunResult = {
      status: 'FAILED',
      runDir: '/tmp/run-002',
      steps: [step],
      finishedAt: '2024-05-29T11:00:00Z',
    };
    const candidates = service.extract(result, makeConfig());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('known_issue');
    expect(candidates[0].confidence).toBe(0.5);
    expect(candidates[0].title).toContain('Locator failed');
  });

  it('ignores non-click steps', () => {
    const step = makeStep({
      stepId: 'step-003',
      resolvedAction: { type: 'fill', targetElementId: 'el_003', value: 'test', reason: 'fill' },
    });
    const result: QaRunResult = {
      status: 'PASSED',
      runDir: '/tmp/run-003',
      steps: [step],
      finishedAt: '2024-05-29T12:00:00Z',
    };
    const candidates = service.extract(result, makeConfig());
    expect(candidates).toHaveLength(0);
  });

  it('extracts scenario_result from passed scenario', () => {
    const result: QaRunResult = {
      status: 'PASSED',
      runDir: '/tmp/run-004',
      steps: [],
      scenarios: [
        {
          id: 'scenario-001',
          title: 'Login flow',
          tasks: [
            { id: 'T001', title: 'Enter credentials', expected: 'Credentials entered', status: 'PASSED' },
            { id: 'T002', title: 'Click login', expected: 'Logged in', status: 'PASSED' },
          ],
          status: 'PASSED',
        },
      ],
      finishedAt: '2024-05-29T13:00:00Z',
    };
    const candidates = service.extract(result, makeConfig());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('scenario_result');
    expect(candidates[0].confidence).toBe(1.0);
    expect(candidates[0].title).toContain('Scenario passed');
  });

  it('extracts known_issue from failed scenario', () => {
    const result: QaRunResult = {
      status: 'FAILED',
      runDir: '/tmp/run-005',
      steps: [],
      scenarios: [
        {
          id: 'scenario-002',
          title: 'Checkout flow',
          tasks: [
            { id: 'T001', title: 'Add to cart', expected: 'Added', status: 'PASSED' },
            { id: 'T002', title: 'Pay', expected: 'Paid', status: 'FAILED' },
          ],
          status: 'FAILED',
        },
      ],
      finishedAt: '2024-05-29T14:00:00Z',
    };
    const candidates = service.extract(result, makeConfig());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('known_issue');
    expect(candidates[0].confidence).toBe(0.6);
    expect(candidates[0].title).toContain('Scenario failed');
  });

  it('extracts both locator and scenario candidates', () => {
    const step = makeStep({
      stepId: 'step-004',
      thoughtSummary: 'Click submit',
      resolvedAction: { type: 'click', targetElementId: 'el_004', reason: 'submit' },
      validation: { ok: true, type: 'no_console_errors', durationMs: 50 },
    });
    const result: QaRunResult = {
      status: 'PASSED',
      runDir: '/tmp/run-006',
      steps: [step],
      scenarios: [
        {
          id: 'scenario-003',
          title: 'Submit form',
          tasks: [{ id: 'T001', title: 'Submit', expected: 'Submitted', status: 'PASSED' }],
          status: 'PASSED',
        },
      ],
      finishedAt: '2024-05-29T15:00:00Z',
    };
    const candidates = service.extract(result, makeConfig());
    expect(candidates).toHaveLength(2);
    expect(candidates.some((c) => c.type === 'locator')).toBe(true);
    expect(candidates.some((c) => c.type === 'scenario_result')).toBe(true);
  });

  it('sets correct source fields on candidates', () => {
    const step = makeStep({
      stepId: 'step-005',
      scenarioId: 'scenario-004',
      taskId: 'T003',
      resolvedAction: { type: 'click', targetElementId: 'el_005', reason: 'test' },
      validation: { ok: true, type: 'no_console_errors', durationMs: 0 },
    });
    const result: QaRunResult = {
      status: 'PASSED',
      runDir: '/tmp/run-007',
      steps: [step],
      finishedAt: '2024-05-29T16:00:00Z',
    };
    const candidates = service.extract(result, makeConfig());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceScenarioId).toBe('scenario-004');
    expect(candidates[0].sourceTaskId).toBe('T003');
    expect(candidates[0].sourceStepId).toBe('step-005');
  });
});
