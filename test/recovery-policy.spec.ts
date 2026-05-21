import { describe, expect, it } from 'vitest';
import { RecoveryPolicyService } from '../src/application/services/recovery-policy.service.js';
import type { BrowserHarnessPort } from '../src/application/ports/browser-harness.port.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';

const observation = (text: string): ScreenObservation => ({
  observationId: `obs-${text}`,
  createdAt: new Date().toISOString(),
  url: 'https://app.local/',
  title: 'App',
  visibleTexts: [text],
  elements: [{ id: 'el_001', role: 'button', name: text, inViewport: true, locator: { strategy: 'text', text } }],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 100, height: 100 }, schemaVersion: 'obs.v1' as const },
});

describe('RecoveryPolicyService', () => {
  it('records an observation failure when recovery does not change state', async () => {
    const attempts: Array<{ actionType: string; result: 'PASSED' | 'FAILED' | 'RECOVERED' | 'BLOCKED'; reason?: string; ts: string }> = [];
    const browser: Partial<BrowserHarnessPort> = {
      async execute(action) {
        return { ok: true, actionType: action.type, durationMs: 1 };
      },
      async waitForQuiescence() {
        return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 };
      },
      async observe() {
        return observation('same');
      },
      async validate() {
        return { ok: false, type: 'text_visible', durationMs: 1 };
      },
    };

    const result = await new RecoveryPolicyService(browser as BrowserHarnessPort).recover({
      expected: { type: 'text_visible', text: 'done' },
      fallback: { type: 'press', key: 'Escape', reason: 'close popup' },
      attempts,
      quiescenceMs: 1,
      maxFallbacks: 1,
      maxEmergencyActions: 0,
      beforeObservation: observation('same'),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('RECOVERY_EXHAUSTED');
    expect(attempts.some((a) => a.actionType === 'recovery-observe' && a.reason?.includes('did not change'))).toBe(true);
  });
});
