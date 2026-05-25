import { describe, expect, it } from 'vitest';

import { ALL_QA_TOOLS } from '../src/application/tools/built-in/index.js';
import { ConditionEvaluateTool } from '../src/application/tools/built-in/evaluate_condition.tool.js';
import { toStructuredToolLike } from '../src/infra/adapters/structured-tool.adapter.js';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';

const observation = {
  observationId: 'obs-1',
  createdAt: new Date().toISOString(),
  url: 'https://app.local/inbox',
  title: 'Inbox',
  visibleTexts: ['Inbox', 'Settings'],
  elements: [],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
};

const beforeState = {
  observationId: 'obs-before',
  url: 'https://app.local/login',
  semanticStates: { auth: 'anonymous', menuOpen: false, account_menu: false },
  attributes: {},
  storage: { 'localStorage:session': 'old' },
  timestamp: '2026-05-22T00:00:00.000Z',
};

const afterState = {
  observationId: 'obs-after',
  url: 'https://app.local/inbox',
  semanticStates: { auth: 'authenticated', menuOpen: true, account_menu: true },
  attributes: {},
  storage: { 'localStorage:session': 'new' },
  timestamp: '2026-05-22T00:00:01.000Z',
};

describe('qa.condition.evaluate', () => {
  it('is internalOnly and is hidden from public tool listings', () => {
    const registry = new QaToolRegistry(ALL_QA_TOOLS);

    expect(ConditionEvaluateTool.internalOnly).toBe(true);
    expect(registry.listPublic().map((tool) => tool.name)).not.toContain('qa.condition.evaluate');
    expect(registry.listAll().map((tool) => tool.name)).toContain('qa.condition.evaluate');
  });

  it('evaluates text conditions and returns a ConditionEvaluationResult-like payload', async () => {
    const registry = new QaToolRegistry([ConditionEvaluateTool]);

    await expect(registry.execute('qa.condition.evaluate', {
      condition: { type: 'text_visible', text: 'Inbox' },
      currentObservation: observation,
      runContext: { phase: 'precondition' },
    }, {}, { includeInternal: true })).resolves.toMatchObject({
      ok: true,
      issues: [],
      result: {
        conditionId: 'tool:condition',
        type: 'text_visible',
        passed: true,
        expected: 'Inbox',
        actual: expect.arrayContaining(['Inbox']),
        before: undefined,
        after: undefined,
        severity: 'INFO',
        reason: 'condition passed',
      },
    });
  });

  it('supports beforeState/afterState comparisons for runtime conditions', async () => {
    const registry = new QaToolRegistry([ConditionEvaluateTool]);

    await expect(registry.execute('qa.condition.evaluate', {
      condition: { type: 'auth_state', expected: 'changed' },
      currentObservation: observation,
      beforeState,
      afterState,
    }, {}, { includeInternal: true })).resolves.toMatchObject({
      ok: true,
      result: {
        type: 'auth_state',
        passed: true,
        expected: 'changed',
        actual: {
          before: 'anonymous',
          after: 'authenticated',
        },
        before: beforeState,
        after: afterState,
      },
    });
  });

  it('does not export to external structured adapters by default', () => {
    expect(toStructuredToolLike(ConditionEvaluateTool)).toBeUndefined();
  });
});
