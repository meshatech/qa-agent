import { Inject, Injectable } from '@nestjs/common';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { BoundExpectedAfterAction, QaAction } from '../../domain/schemas/action.schema.js';
import type { AttemptRecord } from '../../domain/models/run.model.js';

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
  }): Promise<{ ok: boolean; action?: QaAction }> {
    const actions = [input.fallback, { type: 'press', key: 'Escape', reason: 'default recovery escape' } as QaAction, { type: 'clickOutside', reason: 'default recovery outside click' } as QaAction]
      .slice(0, input.maxFallbacks + input.maxEmergencyActions);
    for (const action of actions) {
      const exec = await this.browser.execute(action);
      input.attempts.push({ actionType: action.type, result: exec.ok ? 'RECOVERED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() });
      await this.browser.waitForQuiescence(input.quiescenceMs);
      const validation = await this.browser.validate(input.expected);
      if (exec.ok && validation.ok) return { ok: true, action };
    }
    return { ok: false };
  }
}
