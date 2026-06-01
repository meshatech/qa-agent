import { Injectable } from '@nestjs/common';

import type { ProjectReadinessStatus } from '../../domain/models/readiness.model.js';
import type { PlanExecutionResult } from './plan-executor.service.js';

export interface ReadinessEvaluationInput {
  /** Whether the browser opened successfully */
  browserOpenOk: boolean;
  /** Whether minimal smoke checks passed */
  minimalSmokeOk: boolean;
  /** Whether route accessibility checks passed */
  routeCheckOk: boolean;
  /** Result of the smoke plan execution */
  smokeResult: PlanExecutionResult | null;
  /** Whether an unexpected error occurred during execution */
  executionError: boolean;
}

/**
 * Evaluates and transitions project readiness states based on deterministic criteria.
 *
 * State definitions:
 * - READY: Smoke test passed, browser opened, app surface is accessible.
 * - ONBOARDING_BLOCKED: Smoke test failed, browser failed to open, or an unexpected
 *   execution error occurred. App is not accessible for QA automation.
 * - UNKNOWN: Onboarding has not been executed yet (initial state).
 *
 * Transition rules (deterministic, no cycles):
 * 1. UNKNOWN → ONBOARDING_BLOCKED: if browserOpenOk = false OR executionError = true.
 * 2. UNKNOWN → ONBOARDING_BLOCKED: if smokeResult.ok = false.
 * 3. UNKNOWN → READY: if smokeResult.ok = true.
 */
@Injectable()
export class ReadinessEvaluatorService {
  evaluate(input: ReadinessEvaluationInput): ProjectReadinessStatus {
    if (!input.browserOpenOk || input.executionError) {
      return 'ONBOARDING_BLOCKED';
    }

    if (!input.minimalSmokeOk || !input.routeCheckOk) {
      return 'ONBOARDING_BLOCKED';
    }

    if (input.smokeResult === null) {
      return 'UNKNOWN';
    }

    if (input.smokeResult.ok) {
      return 'READY';
    }

    return 'ONBOARDING_BLOCKED';
  }

  /**
   * Maps a readiness status to a run-history status string.
   */
  toRunHistoryStatus(readiness: ProjectReadinessStatus): 'passed' | 'blocked' | 'failed' {
    switch (readiness) {
      case 'READY':
        return 'passed';
      case 'ONBOARDING_BLOCKED':
        return 'blocked';
      case 'UNKNOWN':
        return 'failed';
    }
  }
}
