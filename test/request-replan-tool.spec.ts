import { describe, expect, it, vi } from 'vitest';

import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { PlanPatchApplierService } from '../src/application/services/plan-patch-applier.service.js';
import { PlanReplannerService } from '../src/application/services/plan-replanner.service.js';
import type { DecisionProviderPort, ReplanInput } from '../src/application/ports/decision-provider.port.js';
import { PlanReplanTool } from '../src/application/tools/built-in/request_replan.tool.js';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { ExecutionStep, PlanPatch } from '../src/domain/schemas/execution-plan.schema.js';

const config = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D1', title: 'Smoke', description: 'Smoke' },
});

const step: ExecutionStep = {
  id: 'S001',
  description: 'Open inbox',
  preconditions: [],
  action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Inbox' }, reason: 'open inbox' },
  postconditions: [{ type: 'text_visible', text: 'Inbox' }],
  assertions: [],
  onFailure: 'RECOVER',
};

const plan = {
  schemaVersion: 'execution-plan.v1',
  planId: 'plan-1',
  version: 1,
  goal: 'Smoke',
  mode: 'HYBRID_GUARDED',
  runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
  steps: [step],
  assertions: [],
};

const observation = {
  observationId: 'obs-1',
  createdAt: new Date().toISOString(),
  url: 'https://app.local/inbox',
  title: 'Inbox',
  visibleTexts: ['Home'],
  elements: [],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
};

const patch = {
  basePlanId: 'plan-1',
  basePlanVersion: 1,
  operation: 'mark_blocked',
  reason: 'No safe locator found',
  replanReason: 'LOCATOR_NOT_FOUND',
  steps: [],
};

function replacementPatch(overrides: Partial<PlanPatch> = {}): PlanPatch {
  return {
    basePlanId: 'plan-1',
    basePlanVersion: 1,
    operation: 'replace_step',
    stepId: 'S001',
    reason: 'fix locator',
    replanReason: 'LOCATOR_NOT_FOUND',
    steps: [{
      ...step,
      action: { type: 'click', target: { strategy: 'text', text: 'Inbox' }, reason: 'open inbox with visible text' },
      postconditions: [{ type: 'text_visible', text: 'Inbox' }],
    }],
    ...overrides,
  };
}

describe('qa.plan.replan', () => {
  it('delegates to PlanReplannerService using controlled replan input aliases', async () => {
    const planReplanner = {
      replan: vi.fn(async () => ({
        plan,
        history: {
          status: 'BLOCKED',
          patch,
          basePlanId: patch.basePlanId,
          basePlanVersion: patch.basePlanVersion,
          reason: patch.reason,
          replanReason: patch.replanReason,
        },
      })),
    };
    const registry = new QaToolRegistry([PlanReplanTool]);

    await expect(registry.execute('qa.plan.replan', {
      config,
      currentPlan: plan,
      failedStep: step,
      failedCondition: { type: 'text_visible', text: 'Inbox' },
      currentObservation: observation,
      replanReason: 'LOCATOR_NOT_FOUND',
      executionContext: { attempt: 1 },
      patchHistory: [],
    }, {
      metadata: { planReplanner },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'BLOCKED',
        patch: {
          basePlanId: 'plan-1',
          basePlanVersion: 1,
          operation: 'mark_blocked',
          replanReason: 'LOCATOR_NOT_FOUND',
        },
      },
    });
    expect(planReplanner.replan).toHaveBeenCalledWith(expect.objectContaining({
      config,
      plan,
      failedStep: step,
      observation,
      reason: 'LOCATOR_NOT_FOUND',
      history: [],
      runData: {},
    }));
  });

  it('returns a controlled blocked result when replanner rejects an invalid patch', async () => {
    const planReplanner = {
      replan: vi.fn(async () => {
        const error = new Error('Patch basePlanVersion does not match current plan version') as Error & { code: string };
        error.code = 'STALE_PLAN_PATCH';
        throw error;
      }),
    };
    const registry = new QaToolRegistry([PlanReplanTool]);

    await expect(registry.execute('qa.plan.replan', {
      config,
      plan,
      failedStep: step,
      observation,
      reason: 'POSTCONDITION_FAILED',
      message: 'Inbox did not appear',
      history: [],
    }, {
      metadata: { planReplanner },
    })).resolves.toEqual({
      ok: false,
      issues: [{
        path: 'planPatch',
        code: 'STALE_PLAN_PATCH',
        message: 'Patch basePlanVersion does not match current plan version',
      }],
    });
  });

  it('does not apply patches outside PlanReplannerService', async () => {
    const planReplanner = {
      replan: vi.fn(async () => ({ plan, history: { status: 'BLOCKED', patch } })),
      apply: vi.fn(),
    };
    const registry = new QaToolRegistry([PlanReplanTool]);

    await registry.execute('qa.plan.replan', {
      config,
      plan,
      failedStep: step,
      observation,
      reason: 'UNEXPECTED_ROUTE',
      message: 'Unexpected route',
      history: [],
    }, {
      metadata: { planReplanner },
    });

    expect(planReplanner.replan).toHaveBeenCalledOnce();
    expect(planReplanner.apply).not.toHaveBeenCalled();
  });

  it('uses PlanReplannerService to support patches wrapper and apply policy validation', async () => {
    const wrappedPatch = replacementPatch();
    const provider = {
      replan: vi.fn(async (_input: ReplanInput) => ({ patches: [wrappedPatch] }) as never),
      async decide() { throw new Error('not used'); },
    } satisfies DecisionProviderPort;
    const planReplanner = new PlanReplannerService(provider, new PlanPatchApplierService(new ActionPolicyService()));
    const registry = new QaToolRegistry([PlanReplanTool]);

    await expect(registry.execute('qa.plan.replan', {
      config,
      plan,
      failedStep: step,
      observation,
      reason: 'LOCATOR_NOT_FOUND',
      message: 'Inbox locator not found',
      history: [],
    }, {
      metadata: { planReplanner },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'APPLIED',
        patch: {
          basePlanId: 'plan-1',
          basePlanVersion: 1,
          operation: 'replace_step',
          replanReason: 'LOCATOR_NOT_FOUND',
        },
        appliedPlan: { version: 2 },
        history: { status: 'APPLIED', appliedPlanVersion: 2 },
      },
    });
    expect(provider.replan).toHaveBeenCalledWith(expect.objectContaining({
      config,
      plan,
      failedStep: step,
      observation,
      reason: 'LOCATOR_NOT_FOUND',
      message: 'Inbox locator not found',
    }));
  });

  it('returns blocked issue when PlanReplannerService rejects a stale patch', async () => {
    const provider = {
      replan: vi.fn(async (_input: ReplanInput) => replacementPatch({
        basePlanVersion: 0,
      })),
      async decide() { throw new Error('not used'); },
    } satisfies DecisionProviderPort;
    const planReplanner = new PlanReplannerService(provider, new PlanPatchApplierService(new ActionPolicyService()));
    const registry = new QaToolRegistry([PlanReplanTool]);

    await expect(registry.execute('qa.plan.replan', {
      config,
      plan,
      failedStep: step,
      observation,
      reason: 'POSTCONDITION_FAILED',
      history: [],
    }, {
      metadata: { planReplanner },
    })).resolves.toEqual({
      ok: false,
      issues: [{
        path: 'planPatch',
        code: 'STALE_PLAN_PATCH',
        message: 'Patch basePlanVersion does not match current plan version',
      }],
    });
  });

  it('returns blocked issue when PlanReplannerService rejects validation weakening', async () => {
    const provider = {
      replan: vi.fn(async (_input: ReplanInput) => replacementPatch({
        steps: [{ ...step, onFailure: 'CONTINUE_WITH_WARNING' as const }],
      })),
      async decide() { throw new Error('not used'); },
    } satisfies DecisionProviderPort;
    const planReplanner = new PlanReplannerService(provider, new PlanPatchApplierService(new ActionPolicyService()));
    const registry = new QaToolRegistry([PlanReplanTool]);

    await expect(registry.execute('qa.plan.replan', {
      config,
      plan,
      failedStep: step,
      observation,
      reason: 'LOCATOR_NOT_FOUND',
      history: [],
    }, {
      metadata: { planReplanner },
    })).resolves.toEqual({
      ok: false,
      issues: [{
        path: 'planPatch',
        code: 'WEAKENED_VALIDATION',
        message: 'Patch cannot turn a functional step into CONTINUE_WITH_WARNING',
      }],
    });
  });
});
