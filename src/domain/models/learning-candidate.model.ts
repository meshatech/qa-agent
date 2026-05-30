import type { LocatorDescriptor } from '../schemas/action.schema.js';

export type LearningType = 'locator' | 'flow' | 'known_issue' | 'scenario_result';

export interface BaseLearning {
  type: LearningType;
  title: string;
  description: string;
  sourceRunId: string;
  sourceScenarioId?: string;
  sourceTaskId?: string;
  confidence: number;
  createdAt: string;
}

export interface LocatorLearning extends BaseLearning {
  type: 'locator';
  locator: LocatorDescriptor;
  resolvedText?: string;
  pageUrl?: string;
  succeeded: boolean;
}

export interface FlowLearning extends BaseLearning {
  type: 'flow';
  steps: Array<{
    order: number;
    action: string;
    target?: string;
    expectedOutcome?: string;
  }>;
  entryPoint?: string;
  exitPoint?: string;
}

export interface KnownIssueLearning extends BaseLearning {
  type: 'known_issue';
  symptom: string;
  cause?: string;
  workaround?: string;
  affectedRoutes?: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ScenarioResultLearning extends BaseLearning {
  type: 'scenario_result';
  scenarioId: string;
  passed: boolean;
  failureReason?: string;
  retryable: boolean;
  assertions: Array<{
    name: string;
    passed: boolean;
    expected?: string;
    actual?: string;
  }>;
}

export type LearningCandidate = LocatorLearning | FlowLearning | KnownIssueLearning | ScenarioResultLearning;
