import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LearningExtractorService } from '../src/application/services/learning-extractor.service.js';
import type { QaRunResult, QaStep } from '../src/domain/models/run.model.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';
import type { RunRepositoryPort } from '../src/application/ports/run-repository.port.js';

const createMockRepository = (): RunRepositoryPort =>
  ({
    appendRunHistory: vi.fn().mockResolvedValue(undefined),
    createRunDir: vi.fn(),
    ensureDir: vi.fn(),
    writeJson: vi.fn(),
    writeFile: vi.fn(),
    writeReport: vi.fn(),
    findRunDir: vi.fn(),
    readJson: vi.fn(),
    exists: vi.fn(),
    listFiles: vi.fn(),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    renameFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunRepositoryPort);

describe('LearningExtractorService', () => {
  const mockRepository = createMockRepository();
  const service = new LearningExtractorService(mockRepository);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeStep = (overrides: Partial<QaStep> & { stepId: string }): QaStep => ({
    scenarioId: overrides.scenarioId ?? 'scenario-001',
    taskId: overrides.taskId ?? 'T001',
    observationId: overrides.observationId ?? 'obs-001',
    thoughtSummary: overrides.thoughtSummary ?? 'Click login button',
    action: overrides.action ?? { type: 'click', targetElementId: 'el_001', reason: 'test' },
    resolvedAction: overrides.resolvedAction ?? { type: 'click', targetElementId: 'el_001', reason: 'test' },
    boundExpected: overrides.boundExpected ?? { type: 'no_console_errors' },
    validation: overrides.validation ?? { ok: true, type: 'no_console_errors', durationMs: 0 },
    ...overrides,
    stepId: overrides.stepId,
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
      expect(candidates[0].metadata).toEqual({ elementId: 'el_001', actionType: 'click', result: 'success' });
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

    it('extracts locator candidate from successful fill step', () => {
      const step = makeStep({
        stepId: 'step-003',
        resolvedAction: { type: 'fill', targetElementId: 'el_003', value: 'test', reason: 'fill' },
      });
      const candidates = service.extractSuccessfulLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].metadata).toEqual({ elementId: 'el_003', actionType: 'fill', result: 'success' });
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

    it('treats step without validation but without error as successful locator', () => {
      const step = makeStep({
        stepId: 'step-no-validation',
        thoughtSummary: 'Wait for stable page',
        resolvedAction: { type: 'click', targetElementId: 'el_stable', reason: 'check' },
        validation: undefined,
      });
      const candidates = service.extractSuccessfulLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('locator');
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
      expect(candidates[0].metadata).toEqual({ elementId: 'el_010', actionType: 'click', result: 'failure' });
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

    it('extracts known_issue from failed fill step', () => {
      const step = makeStep({
        stepId: 'step-012',
        resolvedAction: { type: 'fill', targetElementId: 'el_012', value: 'test', reason: 'fill' },
        validation: { ok: false, type: 'field_value_contains', actual: 'empty', durationMs: 0 },
        error: { code: 'ASSERTION_FAILED', message: 'Value was not filled' },
      });
      const candidates = service.extractFailedLocators([step], 'run-001', '2024-05-29T10:00:00Z');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].metadata).toEqual({ elementId: 'el_012', actionType: 'fill', result: 'failure' });
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
      const scenarios: NonNullable<QaRunResult['scenarios']> = [
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
      const scenarios: NonNullable<QaRunResult['scenarios']> = [
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
      const scenarios: NonNullable<QaRunResult['scenarios']> = [
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
      const scenarios: NonNullable<QaRunResult['scenarios']> = [
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
      const scenarios: NonNullable<QaRunResult['scenarios']> = [
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
      const scenarios: NonNullable<QaRunResult['scenarios']> = [
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

  describe('persist', () => {
    it('appends run history with candidates and renames temp file atomically', async () => {
      const step = makeStep({
        stepId: 'step-persist-001',
        thoughtSummary: 'Click login',
        resolvedAction: { type: 'click', targetElementId: 'el_001', reason: 'login' },
        validation: { ok: true, type: 'no_console_errors', durationMs: 100 },
      });
      const result: QaRunResult = {
        status: 'PASSED',
        runDir: '/tmp/run-persist-001',
        steps: [step],
        finishedAt: '2024-05-29T17:00:00Z',
      };
      const candidates = service.extract(result, makeConfig());
      await service.persist(result, candidates);

      const writeCall = (mockRepository.writeJson as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[0]).toBe('/tmp/run-persist-001');
      expect(writeCall[1]).toMatch(/learning-candidates\.json\..+\.tmp/);
      expect(writeCall[2]).toBe(candidates);

      const renameCall = (mockRepository.renameFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(renameCall[0]).toBe('/tmp/run-persist-001');
      expect(renameCall[1]).toBe(writeCall[1]);
      expect(renameCall[2]).toBe('learning-candidates.json');

      expect(mockRepository.appendRunHistory).toHaveBeenCalledOnce();
      expect((mockRepository.writeJson as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
        .toBeLessThan((mockRepository.renameFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
      expect((mockRepository.renameFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
        .toBeLessThan((mockRepository.appendRunHistory as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);

      const callArgs = (mockRepository.appendRunHistory as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toBe('/tmp/run-persist-001');
      expect(callArgs[1].runId).toBe('run-persist-001');
      expect(callArgs[1].status).toBe('PASSED');
      expect(callArgs[1].totalSteps).toBe(1);
      expect(callArgs[1].candidateCount).toBe(1);
      expect((callArgs[1].candidates ?? [])[0]).toEqual({
        id: candidates[0].id,
        type: 'locator',
        title: candidates[0].title,
        confidence: 0.9,
      });
    });

    it('appends run history with zero candidates', async () => {
      const result: QaRunResult = {
        status: 'PASSED',
        runDir: '/tmp/run-persist-002',
        steps: [],
        finishedAt: '2024-05-29T18:00:00Z',
      };
      const candidates = service.extract(result, makeConfig());
      await service.persist(result, candidates);

      expect(mockRepository.appendRunHistory).toHaveBeenCalledOnce();
      expect(mockRepository.renameFile).toHaveBeenCalledOnce();
      const callArgs = (mockRepository.appendRunHistory as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].candidateCount).toBe(0);
      expect(callArgs[1].candidates ?? []).toEqual([]);
    });

    it('does not append run history when writing temp candidates fails', async () => {
      const result: QaRunResult = {
        status: 'PASSED',
        runDir: '/tmp/run-persist-failure',
        steps: [],
        finishedAt: '2024-05-29T18:30:00Z',
      };
      const candidates = service.extract(result, makeConfig());
      (mockRepository.writeJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

      await expect(service.persist(result, candidates)).rejects.toThrow(/disk full/);
      expect(mockRepository.appendRunHistory).not.toHaveBeenCalled();
      expect(mockRepository.renameFile).not.toHaveBeenCalled();
      expect(mockRepository.deleteFile).toHaveBeenCalledOnce();
      expect((mockRepository.deleteFile as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatch(/learning-candidates\.json\..+\.tmp/);
    });

    it('keeps the renamed file and does not delete when appendRunHistory fails', async () => {
      const result: QaRunResult = {
        status: 'PASSED',
        runDir: '/tmp/run-persist-rollback',
        steps: [],
        finishedAt: '2024-05-29T18:30:00Z',
      };
      const candidates = service.extract(result, makeConfig());
      (mockRepository.appendRunHistory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

      await expect(service.persist(result, candidates)).rejects.toThrow(/disk full/);
      expect(mockRepository.renameFile).toHaveBeenCalledOnce();
      expect(mockRepository.deleteFile).not.toHaveBeenCalled();
    });

    it('cleans up temp file and skips history when renameFile fails', async () => {
      const result: QaRunResult = {
        status: 'PASSED',
        runDir: '/tmp/run-persist-rename-fail',
        steps: [],
        finishedAt: '2024-05-29T18:30:00Z',
      };
      const candidates = service.extract(result, makeConfig());
      (mockRepository.renameFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('rename failed'));

      await expect(service.persist(result, candidates)).rejects.toThrow(/rename failed/);
      expect(mockRepository.appendRunHistory).not.toHaveBeenCalled();
      const deleteCall = (mockRepository.deleteFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(deleteCall[0]).toBe('/tmp/run-persist-rename-fail');
      expect(deleteCall[1]).toMatch(/learning-candidates\.json\..+\.tmp/);
    });

    it('does not call deleteFile on success path', async () => {
      const result: QaRunResult = {
        status: 'PASSED',
        runDir: '/tmp/run-persist-success',
        steps: [],
        finishedAt: '2024-05-29T18:30:00Z',
      };
      const candidates = service.extract(result, makeConfig());
      await service.persist(result, candidates);
      expect(mockRepository.deleteFile).not.toHaveBeenCalled();
    });

    it('appends run history with multiple candidate types', async () => {
      const step = makeStep({
        stepId: 'step-persist-003',
        thoughtSummary: 'Click submit',
        resolvedAction: { type: 'click', targetElementId: 'el_003', reason: 'submit' },
        validation: { ok: true, type: 'no_console_errors', durationMs: 50 },
      });
      const result: QaRunResult = {
        status: 'PASSED',
        runDir: '/tmp/run-persist-003',
        steps: [step],
        scenarios: [
          {
            id: 'scenario-persist-001',
            title: 'Submit form',
            tasks: [{ id: 'T001', title: 'Submit', expected: 'Submitted', status: 'PASSED' }],
            status: 'PASSED',
          },
        ],
        finishedAt: '2024-05-29T19:00:00Z',
      };
      const candidates = service.extract(result, makeConfig());
      await service.persist(result, candidates);

      expect(mockRepository.appendRunHistory).toHaveBeenCalledOnce();
      const callArgs = (mockRepository.appendRunHistory as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].candidateCount).toBe(2);
      expect(callArgs[1].totalScenarios).toBe(1);
      expect((callArgs[1].candidates ?? [])).toHaveLength(2);
    });
  });
});
