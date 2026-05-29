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

  describe('extractSuccessfulLocators', () => {
    it('extracts locator candidate from successful click step', () => {
      const step = makeStep({
        stepId: 'step-001',
        thoughtSummary: 'Click login button',
        resolvedAction: { type: 'click', targetElementId: 'el_001', reason: 'login' },
        validation: { ok: true, type: 'no_console_errors', durationMs: 100 },
      });
      const candidates = service.extractSuccessfulLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('locator');
      expect(candidates[0].confidence).toBe(0.9);
      expect(candidates[0].title).toContain('Resolved locator');
      expect(candidates[0].metadata).toEqual({ elementId: 'el_001', result: 'success' });
    });

    it('ignores failed click steps', () => {
      const step = makeStep({
        stepId: 'step-002',
        thoughtSummary: 'Click broken button',
        resolvedAction: { type: 'click', targetElementId: 'el_002', reason: 'test' },
        validation: { ok: false, type: 'no_console_errors', actual: 'Error', durationMs: 0 },
        error: { code: 'LOCATOR_NOT_FOUND', message: 'Element not found' },
      });
      const candidates = service.extractSuccessfulLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(0);
    });

    it('ignores non-click steps', () => {
      const step = makeStep({
        stepId: 'step-003',
        resolvedAction: { type: 'fill', targetElementId: 'el_003', value: 'test', reason: 'fill' },
      });
      const candidates = service.extractSuccessfulLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(0);
    });

    it('ignores click steps without targetElementId', () => {
      const step = makeStep({
        stepId: 'step-004',
        resolvedAction: { type: 'click', reason: 'click somewhere' } as QaStep['resolvedAction'],
        validation: { ok: true, type: 'no_console_errors', durationMs: 0 },
      });
      const candidates = service.extractSuccessfulLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(0);
    });

    it('sets correct source fields on successful locator candidate', () => {
      const step = makeStep({
        stepId: 'step-005',
        scenarioId: 'scenario-004',
        taskId: 'T003',
        resolvedAction: { type: 'click', targetElementId: 'el_005', reason: 'test' },
        validation: { ok: true, type: 'no_console_errors', durationMs: 0 },
      });
      const candidates = service.extractSuccessfulLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].sourceScenarioId).toBe('scenario-004');
      expect(candidates[0].sourceTaskId).toBe('T003');
      expect(candidates[0].sourceStepId).toBe('step-005');
    });

    it('extracts multiple successful locators', () => {
      const steps = [
        makeStep({
          stepId: 'step-006',
          thoughtSummary: 'Click submit',
          resolvedAction: { type: 'click', targetElementId: 'el_006', reason: 'submit' },
          validation: { ok: true, type: 'no_console_errors', durationMs: 50 },
        }),
        makeStep({
          stepId: 'step-007',
          thoughtSummary: 'Click cancel',
          resolvedAction: { type: 'click', targetElementId: 'el_007', reason: 'cancel' },
          validation: { ok: true, type: 'no_console_errors', durationMs: 30 },
        }),
      ];
      const candidates = service.extractSuccessfulLocators(steps, 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(2);
      expect(candidates[0].type).toBe('locator');
      expect(candidates[1].type).toBe('locator');
      expect(candidates[0].confidence).toBe(0.9);
      expect(candidates[1].confidence).toBe(0.9);
    });
  });

  describe('extractFailedLocators', () => {
    it('extracts known_issue from failed click step', () => {
      const step = makeStep({
        stepId: 'step-010',
        thoughtSummary: 'Click broken button',
        resolvedAction: { type: 'click', targetElementId: 'el_010', reason: 'test' },
        validation: { ok: false, type: 'no_console_errors', actual: 'Error', durationMs: 0 },
        error: { code: 'LOCATOR_NOT_FOUND', message: 'Element not found' },
      });
      const candidates = service.extractFailedLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('known_issue');
      expect(candidates[0].confidence).toBe(0.5);
      expect(candidates[0].title).toContain('Failed locator');
      expect(candidates[0].metadata).toEqual({ elementId: 'el_010', result: 'failure' });
    });

    it('ignores successful click steps', () => {
      const step = makeStep({
        stepId: 'step-011',
        thoughtSummary: 'Click login button',
        resolvedAction: { type: 'click', targetElementId: 'el_011', reason: 'login' },
        validation: { ok: true, type: 'no_console_errors', durationMs: 100 },
      });
      const candidates = service.extractFailedLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(0);
    });

    it('ignores non-click steps', () => {
      const step = makeStep({
        stepId: 'step-012',
        resolvedAction: { type: 'fill', targetElementId: 'el_012', value: 'test', reason: 'fill' },
      });
      const candidates = service.extractFailedLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(0);
    });

    it('ignores click steps without targetElementId', () => {
      const step = makeStep({
        stepId: 'step-013',
        resolvedAction: { type: 'click', reason: 'click somewhere' } as QaStep['resolvedAction'],
        validation: { ok: false, type: 'no_console_errors', actual: 'Error', durationMs: 0 },
        error: { code: 'LOCATOR_NOT_FOUND', message: 'Not found' },
      });
      const candidates = service.extractFailedLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(0);
    });

    it('sets correct source fields on failed locator candidate', () => {
      const step = makeStep({
        stepId: 'step-014',
        scenarioId: 'scenario-005',
        taskId: 'T004',
        resolvedAction: { type: 'click', targetElementId: 'el_014', reason: 'test' },
        validation: { ok: false, type: 'no_console_errors', actual: 'Timeout', durationMs: 0 },
        error: { code: 'LOCATOR_NOT_FOUND', message: 'Timeout' },
      });
      const candidates = service.extractFailedLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].sourceScenarioId).toBe('scenario-005');
      expect(candidates[0].sourceTaskId).toBe('T004');
      expect(candidates[0].sourceStepId).toBe('step-014');
    });

    it('extracts multiple failed locators', () => {
      const steps = [
        makeStep({
          stepId: 'step-015',
          thoughtSummary: 'Click missing',
          resolvedAction: { type: 'click', targetElementId: 'el_015', reason: 'test' },
          validation: { ok: false, type: 'no_console_errors', actual: 'Not found', durationMs: 0 },
          error: { code: 'LOCATOR_NOT_FOUND', message: 'Not found' },
        }),
        makeStep({
          stepId: 'step-016',
          thoughtSummary: 'Click stale',
          resolvedAction: { type: 'click', targetElementId: 'el_016', reason: 'test' },
          validation: { ok: false, type: 'no_console_errors', actual: 'Stale', durationMs: 0 },
          error: { code: 'LOCATOR_NOT_FOUND', message: 'Stale element' },
        }),
      ];
      const candidates = service.extractFailedLocators(steps, 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(2);
      expect(candidates[0].type).toBe('known_issue');
      expect(candidates[1].type).toBe('known_issue');
      expect(candidates[0].confidence).toBe(0.5);
      expect(candidates[1].confidence).toBe(0.5);
    });
  });

  describe('extractScenarioResults', () => {
    it('extracts scenario_result from passed scenario', () => {
      const scenarios = [
        {
          id: 'scenario-006',
          title: 'Login flow passed',
          tasks: [
            { id: 'T001', title: 'Enter credentials', expected: 'Entered', status: 'PASSED' },
            { id: 'T002', title: 'Click login', expected: 'Logged in', status: 'PASSED' },
          ],
          status: 'PASSED' as const,
        },
      ];
      const candidates = service.extractScenarioResults(scenarios, 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('scenario_result');
      expect(candidates[0].confidence).toBe(1.0);
      expect(candidates[0].title).toContain('Scenario passed');
      expect(candidates[0].metadata).toEqual({ scenarioStatus: 'PASSED' });
    });

    it('extracts known_issue from failed scenario', () => {
      const scenarios = [
        {
          id: 'scenario-007',
          title: 'Checkout flow failed',
          tasks: [
            { id: 'T001', title: 'Add to cart', expected: 'Added', status: 'PASSED' },
            { id: 'T002', title: 'Pay', expected: 'Paid', status: 'FAILED' },
          ],
          status: 'FAILED' as const,
        },
      ];
      const candidates = service.extractScenarioResults(scenarios, 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('known_issue');
      expect(candidates[0].confidence).toBe(0.6);
      expect(candidates[0].title).toContain('Scenario failed');
      expect(candidates[0].metadata).toEqual({ scenarioStatus: 'FAILED' });
    });

    it('ignores scenarios with non-final status', () => {
      const scenarios = [
        {
          id: 'scenario-008',
          title: 'Pending scenario',
          tasks: [{ id: 'T001', title: 'Do something', expected: 'Done', status: 'PENDING' }],
          status: 'PLANNED' as const,
        },
      ];
      const candidates = service.extractScenarioResults(scenarios, 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(0);
    });

    it('extracts blocked scenario as known_issue', () => {
      const scenarios = [
        {
          id: 'scenario-009',
          title: 'Blocked scenario',
          tasks: [{ id: 'T001', title: 'Step 1', expected: 'Done', status: 'BLOCKED' }],
          status: 'BLOCKED' as const,
        },
      ];
      const candidates = service.extractScenarioResults(scenarios, 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('known_issue');
      expect(candidates[0].confidence).toBe(0.6);
      expect(candidates[0].title).toContain('Scenario blocked');
    });

    it('sets correct source fields on scenario candidate', () => {
      const scenarios = [
        {
          id: 'scenario-010',
          title: 'Auth flow',
          tasks: [{ id: 'T001', title: 'Auth', expected: 'Authed', status: 'PASSED' }],
          status: 'PASSED' as const,
        },
      ];
      const candidates = service.extractScenarioResults(scenarios, 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].sourceScenarioId).toBe('scenario-010');
      expect(candidates[0].sourceRunId).toBe('run-001');
    });

    it('extracts multiple scenarios with mixed results', () => {
      const scenarios = [
        {
          id: 'scenario-011',
          title: 'Passing scenario',
          tasks: [{ id: 'T001', title: 'Step', expected: 'Done', status: 'PASSED' }],
          status: 'PASSED' as const,
        },
        {
          id: 'scenario-012',
          title: 'Failing scenario',
          tasks: [{ id: 'T001', title: 'Step', expected: 'Done', status: 'FAILED' }],
          status: 'FAILED' as const,
        },
      ];
      const candidates = service.extractScenarioResults(scenarios, 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(2);
      expect(candidates[0].type).toBe('scenario_result');
      expect(candidates[1].type).toBe('known_issue');
    });
  });

  describe('extract (full pipeline)', () => {
    it('extracts both successful locators and scenario results', () => {
      const step = makeStep({
        stepId: 'step-008',
        thoughtSummary: 'Click submit',
        resolvedAction: { type: 'click', targetElementId: 'el_008', reason: 'submit' },
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

    it('extracts failed locators as known_issue via extract pipeline', () => {
      const step = makeStep({
        stepId: 'step-009',
        thoughtSummary: 'Click broken',
        resolvedAction: { type: 'click', targetElementId: 'el_009', reason: 'test' },
        validation: { ok: false, type: 'no_console_errors', actual: 'Error', durationMs: 0 },
        error: { code: 'LOCATOR_NOT_FOUND', message: 'Not found' },
      });
      const result: QaRunResult = {
        status: 'FAILED',
        runDir: '/tmp/run-009',
        steps: [step],
        finishedAt: '2024-05-29T16:00:00Z',
      };
      const candidates = service.extract(result, makeConfig());
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('known_issue');
      expect(candidates[0].confidence).toBe(0.5);
    });
  });
});
