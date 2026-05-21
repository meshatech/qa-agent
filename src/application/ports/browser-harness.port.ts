import type { BoundExpectedAfterAction, QaAction } from '../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { ActionExecutionResult, AssertionResult, QuiescenceResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { PlanCondition, RuntimeStateSnapshot } from '../../domain/schemas/execution-plan.schema.js';

export interface BrowserHarnessPort {
  open(config: RunConfig): Promise<void>;
  captureAuth(config: RunConfig, outputPath: string): Promise<void>;
  observe(): Promise<ScreenObservation>;
  execute(action: QaAction): Promise<ActionExecutionResult>;
  validate(expected: BoundExpectedAfterAction): Promise<AssertionResult>;
  runtimeState?(observation: ScreenObservation, conditions: PlanCondition[]): Promise<RuntimeStateSnapshot>;
  waitForQuiescence(timeoutMs: number): Promise<QuiescenceResult>;
  screenshot(): Promise<Buffer | undefined>;
  domSnapshot(): Promise<string | undefined>;
  networkLog(): unknown[];
  consoleLog(): string;
  saveTrace(path: string): Promise<void>;
  saveVideo(path: string): Promise<void>;
  close(): Promise<void>;
}
