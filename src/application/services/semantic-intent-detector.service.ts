import { Injectable } from '@nestjs/common';

import type { QaTask } from '../../domain/models/run.model.js';
import type { ExpectedOutcomeKind } from '../../domain/schemas/expected-outcome.schema.js';

export type TaskIntentKind =
  | 'AUTHENTICATION'
  | 'DEAUTHENTICATION'
  | 'NAVIGATION'
  | 'APPEARANCE_CHANGE'
  | 'DISCLOSURE'
  | 'GENERIC';

/**
 * Classifies the high-level intent of a QaTask.
 *
 * When the task carries a typed ExpectedOutcome contract, the intent is
 * derived from it — no word/regex matching. This is the word-agnostic path
 * and works for any language or UI wording.
 *
 * When no contract is present, returns GENERIC. The upstream
 * ExpectedOutcomeResolverService handles resolution (LLM or NO_REGRESSION).
 */
@Injectable()
export class SemanticIntentDetectorService {
  classify(task: QaTask): TaskIntentKind {
    if (task.expectedOutcome) {
      return this.fromOutcomeKind(task.expectedOutcome.kind);
    }
    return 'GENERIC';
  }

  isLogout(task: QaTask): boolean {
    return this.classify(task) === 'DEAUTHENTICATION';
  }

  isTheme(task: QaTask): boolean {
    return this.classify(task) === 'APPEARANCE_CHANGE';
  }

  isMenu(task: QaTask): boolean {
    return this.classify(task) === 'DISCLOSURE';
  }

  isAuthentication(task: QaTask): boolean {
    return this.classify(task) === 'AUTHENTICATION';
  }

  isNavigation(task: QaTask): boolean {
    return this.classify(task) === 'NAVIGATION';
  }

  private fromOutcomeKind(kind: ExpectedOutcomeKind): TaskIntentKind {
    switch (kind) {
      case 'AUTHENTICATION':
        return 'AUTHENTICATION';
      case 'DEAUTHENTICATION':
        return 'DEAUTHENTICATION';
      case 'NAVIGATION':
        return 'NAVIGATION';
      case 'APPEARANCE_CHANGE':
        return 'APPEARANCE_CHANGE';
      case 'DISCLOSURE':
        return 'DISCLOSURE';
      default:
        return 'GENERIC';
    }
  }

}
