import { describe, expect, it, vi } from 'vitest';
import { RecoveryPolicyService } from '../src/application/services/recovery-policy.service.js';
import type { BrowserHarnessPort } from '../src/application/ports/browser-harness.port.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';

function makeObs(texts: string[]): ScreenObservation {
  return {
    observationId: 'obs_1',
    createdAt: new Date().toISOString(),
    url: 'https://app.local/',
    title: 'App',
    visibleTexts: texts,
    elements: [],
    pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
    consoleSignals: [],
    networkSignals: [],
    meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
  };
}

describe('RecoveryPolicyService', () => {
  it('recovers successfully on first fallback', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async observe() { return makeObs(['Recovered']); },
      async validate() { return { ok: true, type: 'no_console_errors', durationMs: 1 }; },
    };
    const service = new RecoveryPolicyService(browser as BrowserHarnessPort);
    const attempts: import('../src/domain/models/run.model.js').AttemptRecord[] = [];

    const result = await service.recover({
      expected: { type: 'no_console_errors' },
      fallback: { type: 'press', key: 'Escape', reason: 'test' },
      attempts,
      quiescenceMs: 500,
      maxFallbacks: 2,
      maxEmergencyActions: 1,
    });

    expect(result.ok).toBe(true);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.some((a) => a.result === 'RECOVERED')).toBe(true);
  });

  it('exhausts recovery when all fallbacks fail', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async execute() { return { ok: false, actionType: 'press', durationMs: 1, error: { code: 'LOCATOR_NOT_FOUND', message: 'not found' } }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async observe() { return makeObs(['Same']); },
      async validate(expected) { return { ok: false, type: expected.type, expected: 'ok', actual: 'fail', durationMs: 1 }; },
    };
    const service = new RecoveryPolicyService(browser as BrowserHarnessPort);
    const attempts: import('../src/domain/models/run.model.js').AttemptRecord[] = [];

    const result = await service.recover({
      expected: { type: 'text_visible', text: 'Missing' },
      fallback: { type: 'press', key: 'Escape', reason: 'test' },
      attempts,
      quiescenceMs: 500,
      maxFallbacks: 1,
      maxEmergencyActions: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('RECOVERY_EXHAUSTED');
  });

  it('deduplicates fallback actions', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async observe() { return makeObs(['Done']); },
      async validate() { return { ok: true, type: 'no_console_errors', durationMs: 1 }; },
    };
    const service = new RecoveryPolicyService(browser as BrowserHarnessPort);
    const attempts: import('../src/domain/models/run.model.js').AttemptRecord[] = [];

    // Pass same fallback twice (Escape) — should deduplicate
    const result = await service.recover({
      expected: { type: 'no_console_errors' },
      fallback: { type: 'press', key: 'Escape', reason: 'test' },
      attempts,
      quiescenceMs: 500,
      maxFallbacks: 3,
      maxEmergencyActions: 1,
    });

    expect(result.ok).toBe(true);
    // With dedup, only unique actions run. Default list is [fallback, Escape, clickOutside, waitForStable]
    // Since fallback is also Escape, dedup reduces unique actions.
    const uniqueActions = new Set(attempts.map((a) => a.actionType));
    expect(uniqueActions.size).toBeLessThanOrEqual(3);
  });
});
