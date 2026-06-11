import { describe, expect, it, vi } from 'vitest';
import { OrchestratorReplanService } from '../src/application/services/orchestrator-replan.service.js';
import type { OrchestratorReplanInput } from '../src/application/services/orchestrator-replan.service.js';
import type { ToolQueue } from '../src/domain/schemas/tool-queue.schema.js';
import type { ExecutionPlan, ReplanReason } from '../src/domain/schemas/execution-plan.schema.js';

const mockPlan = (): ExecutionPlan => ({
  schemaVersion: 'execution-plan.v1',
  planId: 'plan-001',
  version: 1,
  goal: 'Test login',
  mode: 'HYBRID_GUARDED',
  runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK' },
  steps: [
    {
      id: 'step-001',
      scenarioId: 'scenario-001',
      taskId: 'T001',
      description: 'Open login page',
      preconditions: [],
      action: { type: 'navigate', to: 'https://example.com/login', reason: 'Open login' },
      postconditions: [{ type: 'url_contains', value: '/login' }],
      assertions: [],
      onFailure: 'RECOVER',
    },
    {
      id: 'step-002',
      scenarioId: 'scenario-001',
      taskId: 'T001',
      description: 'Fill username',
      preconditions: [],
      action: { type: 'fill', target: { strategy: 'text_any', texts: ['username'] }, value: 'test', reason: 'Fill username' },
      postconditions: [{ type: 'field_value_contains', target: { strategy: 'text_any', texts: ['username'] }, value: 'test' }],
      assertions: [],
      onFailure: 'RECOVER',
    },
  ],
  assertions: [],
});

const mockObservation = () => ({
  observationId: 'obs-001',
  createdAt: new Date().toISOString(),
  url: 'https://example.com/login',
  title: 'Login',
  visibleTexts: ['Username', 'Password', 'Login'],
  elements: [
    { id: 'el_001', role: 'textbox', name: 'Username', inViewport: true, locator: { strategy: 'role' as const, role: 'textbox', name: 'Username' } },
    { id: 'el_002', role: 'textbox', name: 'Password', inViewport: true, locator: { strategy: 'role' as const, role: 'textbox', name: 'Password' } },
  ],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1366, height: 768 }, schemaVersion: 'obs.v1' as const },
});

const mockOriginalQueue = (): ToolQueue => ({
  taskQueue: [
    { step: 1, tool: 'navigator.open', params: { url: 'https://example.com/login' } },
    { step: 2, tool: 'actor.fill', params: { target: { strategy: 'text_any', texts: ['username'] }, value: 'test' } },
  ],
  reasoning: 'Open and fill',
});

describe('OrchestratorReplanService', () => {
  it('returns PlanPatch on successful replan', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      action: 'replace_remaining_steps',
      fromStep: 2,
      taskQueue: [
        { step: 2, tool: 'explorer.scan', params: { mode: 'scan_inputs' } },
      ],
      reasoning: 'Locator failed, scan inputs',
    }));

    const svc = new OrchestratorReplanService(llmCall);
    const input: OrchestratorReplanInput = {
      taskTitle: 'Login',
      taskExpected: 'User logs in',
      originalPlan: mockPlan(),
      failedStep: mockPlan().steps[1],
      observation: mockObservation(),
      replanReason: 'LOCATOR_NOT_FOUND' as ReplanReason,
      errorMessage: 'Element not found',
      executedSteps: [{ stepId: 'step-001', tool: 'navigator.open', ok: true }],
      originalQueue: mockOriginalQueue(),
    };

    const patch = await svc.replan(input);

    expect(patch.operation).toBe('replace_remaining_steps');
    expect(patch.stepId).toBe('step-002');
    expect(patch.steps).toHaveLength(1);
    expect(patch.replanReason).toBe('LOCATOR_NOT_FOUND');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('returns abort patch when LLM suggests abort', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      action: 'abort',
      reasoning: 'No reliable locator found',
    }));

    const svc = new OrchestratorReplanService(llmCall);
    const input: OrchestratorReplanInput = {
      taskTitle: 'Login',
      taskExpected: 'User logs in',
      originalPlan: mockPlan(),
      failedStep: mockPlan().steps[1],
      observation: mockObservation(),
      replanReason: 'LOCATOR_NOT_FOUND' as ReplanReason,
      errorMessage: 'Element not found',
      executedSteps: [{ stepId: 'step-001', tool: 'navigator.open', ok: true }],
      originalQueue: mockOriginalQueue(),
    };

    const patch = await svc.replan(input);

    expect(patch.operation).toBe('mark_blocked');
    expect(patch.steps).toHaveLength(0);
  });

  it('retries on invalid JSON and returns blocked after retries', async () => {
    const llmCall = vi.fn()
      .mockResolvedValueOnce('not valid json')
      .mockResolvedValueOnce(JSON.stringify({
        action: 'abort',
        reasoning: 'Giving up',
      }));

    const svc = new OrchestratorReplanService(llmCall);
    const input: OrchestratorReplanInput = {
      taskTitle: 'Login',
      taskExpected: 'User logs in',
      originalPlan: mockPlan(),
      failedStep: mockPlan().steps[1],
      observation: mockObservation(),
      replanReason: 'LOCATOR_NOT_FOUND' as ReplanReason,
      errorMessage: 'Element not found',
      executedSteps: [{ stepId: 'step-001', tool: 'navigator.open', ok: true }],
      originalQueue: mockOriginalQueue(),
    };

    const patch = await svc.replan(input);

    expect(llmCall).toHaveBeenCalledTimes(2);
    expect(patch.operation).toBe('mark_blocked');
  });

  it('returns blocked when all retries fail', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM timeout'));

    const svc = new OrchestratorReplanService(llmCall);
    const input: OrchestratorReplanInput = {
      taskTitle: 'Login',
      taskExpected: 'User logs in',
      originalPlan: mockPlan(),
      failedStep: mockPlan().steps[1],
      observation: mockObservation(),
      replanReason: 'LOCATOR_NOT_FOUND' as ReplanReason,
      errorMessage: 'Element not found',
      executedSteps: [{ stepId: 'step-001', tool: 'navigator.open', ok: true }],
      originalQueue: mockOriginalQueue(),
    };

    const patch = await svc.replan(input);

    expect(llmCall).toHaveBeenCalledTimes(2);
    expect(patch.operation).toBe('mark_blocked');
  });

  it('does not call browser or execute actions', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      action: 'abort',
      reasoning: 'Test',
    }));

    const svc = new OrchestratorReplanService(llmCall);
    const input: OrchestratorReplanInput = {
      taskTitle: 'Login',
      taskExpected: 'User logs in',
      originalPlan: mockPlan(),
      failedStep: mockPlan().steps[1],
      observation: mockObservation(),
      replanReason: 'LOCATOR_NOT_FOUND' as ReplanReason,
      errorMessage: 'Element not found',
      executedSteps: [],
      originalQueue: mockOriginalQueue(),
    };

    await svc.replan(input);

    // Only LLM call — no browser, no execution
    expect(llmCall).toHaveBeenCalledTimes(1);
  });
});
