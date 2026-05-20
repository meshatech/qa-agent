import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { QaScenario } from '../../domain/models/run.model.js';

export interface DecisionInput {
  config: RunConfig;
  observation: ScreenObservation;
  runData: Record<string, string>;
}

export interface DecisionProviderPort {
  plan?(config: RunConfig): Promise<QaScenario[]>;
  decide(input: DecisionInput): Promise<QaActionEnvelope>;
  stats?(): { calls: number; tokensIn?: number; tokensOut?: number };
}
