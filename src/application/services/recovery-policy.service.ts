import { Inject, Injectable } from '@nestjs/common';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { BoundExpectedAfterAction, QaAction } from '../../domain/schemas/action.schema.js';
import type { AttemptRecord } from '../../domain/models/run.model.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';

@Injectable()
export class RecoveryPolicyService {
  constructor(@Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort) {}

  async recover(input: {
    expected: BoundExpectedAfterAction;
    fallback: QaAction;
    attempts: AttemptRecord[];
    quiescenceMs: number;
    maxFallbacks: number;
    maxEmergencyActions: number;
    beforeObservation?: ScreenObservation;
  }): Promise<{ ok: boolean; action?: QaAction; reason?: string }> {
    const actions = this.uniqueActions([
      input.fallback,
      { type: 'press', key: 'Escape', reason: 'default recovery escape' } as QaAction,
      { type: 'clickOutside', reason: 'default recovery outside click' } as QaAction,
      { type: 'waitForStable', timeoutMs: input.quiescenceMs, reason: 'default recovery wait for stable UI' } as QaAction,
    ]).slice(0, input.maxFallbacks + input.maxEmergencyActions);
    let before = input.beforeObservation;
    for (const action of actions) {
      const exec = await this.browser.execute(action);
      input.attempts.push({ actionType: action.type, result: exec.ok ? 'RECOVERED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() });
      await this.browser.waitForQuiescence(input.quiescenceMs);
      const after = await this.browser.observe().catch(() => undefined);
      if (before && after && !this.changed(before, after) && action.type !== 'waitForStable') {
        input.attempts.push({ actionType: 'recovery-observe', result: 'FAILED', reason: 'recovery action did not change observable state', ts: new Date().toISOString() });
      }
      const validation = await this.browser.validate(input.expected);
      if (exec.ok && validation.ok) return { ok: true, action };
      before = after ?? before;
    }
    return { ok: false, reason: 'RECOVERY_EXHAUSTED' };
  }

  private uniqueActions(actions: QaAction[]): QaAction[] {
    const seen = new Set<string>();
    return actions.filter((action) => {
      const key = JSON.stringify({ ...action, reason: undefined });
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private changed(before: ScreenObservation, after: ScreenObservation): boolean {
    if (before.url !== after.url || before.title !== after.title) return true;
    if (before.visibleTexts.slice(0, 10).join('|') !== after.visibleTexts.slice(0, 10).join('|')) return true;
    return before.elements.slice(0, 15).map((e) => `${e.role}:${e.name}:${e.inViewport}:${e.expanded ?? ''}`).join('|')
      !== after.elements.slice(0, 15).map((e) => `${e.role}:${e.name}:${e.inViewport}:${e.expanded ?? ''}`).join('|');
  }
}
