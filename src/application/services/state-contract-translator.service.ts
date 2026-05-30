import { Injectable } from '@nestjs/common';

import type { ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';
import type { PlanCondition } from '../../domain/schemas/execution-plan.schema.js';

/**
 * Translates a high-level, demand-derived ExpectedOutcome into concrete typed
 * PlanCondition postconditions that the runtime validates against real
 * application state. This is a deterministic domain mapping (closed enum ->
 * typed conditions); it never inspects free text or matches words.
 */
@Injectable()
export class StateContractTranslatorService {
  toPostconditions(outcome: ExpectedOutcome): PlanCondition[] {
    switch (outcome.kind) {
      case 'AUTHENTICATION':
        return [{ type: 'auth_state', expected: 'authenticated' }];

      case 'DEAUTHENTICATION':
        return [{ type: 'auth_state', expected: 'anonymous' }];

      case 'NAVIGATION':
        return [this.navigationCondition(outcome.target)];

      case 'APPEARANCE_CHANGE':
        return [
          {
            type: 'ui_state',
            semanticKey: outcome.target ?? 'appearance_mode',
            expected: 'exists',
            source: 'dom',
          },
        ];

      case 'DISCLOSURE':
        return [
          {
            type: 'menu_state',
            semanticKey: outcome.target ?? 'menu',
            expected: 'open',
          },
        ];

      case 'CONTENT_PRESENCE':
        return outcome.target
          ? [{ type: 'text_visible', text: outcome.target }]
          : [{ type: 'no_console_errors' }];

      case 'DATA_ENTRY':
        // Without a concrete locator at the demand layer we cannot bind a
        // field_value_contains; the action itself proves the entry and the
        // safety postcondition guards against runtime errors.
        return [{ type: 'no_console_errors' }];

      case 'NO_REGRESSION':
      case 'CLASSIFICATION_FAILED':
        return [{ type: 'no_console_errors' }];

      default:
        return [{ type: 'no_console_errors' }];
    }
  }

  private navigationCondition(target?: string): PlanCondition {
    if (!target) {
      return { type: 'route_state', expected: 'changed' };
    }
    return { type: 'route_state', expected: 'matches', expectedUrlPattern: target };
  }
}
