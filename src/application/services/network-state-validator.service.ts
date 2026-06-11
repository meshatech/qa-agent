import { Injectable } from '@nestjs/common';
import type { PlanCondition } from '../../domain/schemas/execution-plan.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { AssertionResult } from '../../domain/models/run.model.js';

interface NetworkStateCondition {
  type: 'network_state';
  expected: 'no_errors' | 'no_4xx' | 'no_5xx' | 'has_request_to';
  urlPattern?: string;
  minStatus?: number;
  maxStatus?: number;
}

@Injectable()
export class NetworkStateValidatorService {
  validate(condition: PlanCondition, obs: ScreenObservation): AssertionResult | undefined {
    if (condition.type !== 'network_state') return undefined;
    const net = condition as unknown as NetworkStateCondition;

    const signals = obs.networkSignals.filter((s) => s.isAppOrigin);

    switch (net.expected) {
      case 'no_errors': {
        const failed = signals.filter((s) => s.status >= 400 || s.failure);
        return this.result(net, failed.length === 0, failed.map((s) => `${s.method} ${s.url} → ${s.status}${s.failure ? ` (${s.failure})` : ''}`).join('; ') || 'no network errors');
      }
      case 'no_4xx': {
        const failed = signals.filter((s) => (s.status >= 400 && s.status < 500) || s.failure);
        return this.result(net, failed.length === 0, failed.map((s) => `${s.method} ${s.url} → ${s.status}`).join('; ') || 'no 4xx errors');
      }
      case 'no_5xx': {
        const failed = signals.filter((s) => s.status >= 500 || s.failure);
        return this.result(net, failed.length === 0, failed.map((s) => `${s.method} ${s.url} → ${s.status}`).join('; ') || 'no 5xx errors');
      }
      case 'has_request_to': {
        if (!net.urlPattern) {
          return { ok: false, type: 'network_state', expected: 'has_request_to with urlPattern', actual: 'urlPattern missing', durationMs: 0 };
        }
        const matched = signals.filter((s) => s.url.includes(net.urlPattern!));
        const minStatus = net.minStatus ?? 200;
        const maxStatus = net.maxStatus ?? 399;
        const inRange = matched.filter((s) => s.status >= minStatus && s.status <= maxStatus);
        return this.result(net, inRange.length > 0, `found ${inRange.length}/${matched.length} matching requests in range ${minStatus}-${maxStatus}`);
      }
    }
  }

  private result(condition: NetworkStateCondition, ok: boolean, detail: string): AssertionResult {
    return {
      ok,
      type: condition.type,
      expected: `${condition.expected}${condition.urlPattern ? ` (${condition.urlPattern})` : ''}`,
      actual: detail,
      durationMs: 0,
    };
  }
}
