import type { BoundExpectedAfterAction, QaAction } from '../schemas/action.schema.js';

export type QaRunStatus = 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED' | 'BLOCKED';
export type RuntimeErrorCode =
  | 'STALE_OBSERVATION'
  | 'LOCATOR_NOT_FOUND'
  | 'DYNAMIC_DATA_KEY_NOT_FOUND'
  | 'ACTION_SCHEMA_INVALID'
  | 'ASSERTION_FAILED'
  | 'RECOVERY_EXHAUSTED'
  | 'NAVIGATION_BLOCKED'
  | 'CONCURRENT_ACTION_DENIED'
  | 'QUIESCENCE_TIMEOUT'
  | 'RUN_TIMEOUT'
  | 'TASK_DEPENDENCY_BLOCKED';

export type BugSignalType =
  | 'ASSERTION_FAILURE'
  | 'APP_CONSOLE_EXCEPTION'
  | 'APP_NETWORK_5XX'
  | 'APP_NETWORK_4XX_UNEXPECTED'
  | 'THIRD_PARTY_NETWORK_FAILURE'
  | 'TIMEOUT'
  | 'LOADING_STUCK'
  | 'NAVIGATION_UNEXPECTED'
  | 'VISUAL_BROKEN'
  | 'DEPRECATION_WARNING'
  | 'TRACKING_ERROR';

export type BugCategory =
  | 'APP_FAULT'
  | 'ASSERTION_FAULT'
  | 'NAVIGATION_FAULT'
  | 'THIRD_PARTY_NOISE'
  | 'TRACKING_NOISE'
  | 'DEPRECATION_WARNING'
  | 'BROWSER_EXTENSION_NOISE';

export type ScenarioIntent = 'POSITIVE' | 'NEGATIVE' | 'EDGE' | 'EXPLORATORY';

export interface QuiescenceResult {
  stable: boolean;
  reason: 'NETWORK_AND_DOM_IDLE' | 'DOM_IDLE_ONLY' | 'TIMEOUT_BUT_CONTINUABLE';
  elapsedMs: number;
}

export interface AssertionResult {
  ok: boolean;
  type: string;
  expected?: string;
  actual?: string;
  durationMs: number;
}

export interface ActionExecutionResult {
  ok: boolean;
  actionType: string;
  durationMs: number;
  error?: { code: RuntimeErrorCode; message: string };
  quiescence?: QuiescenceResult;
}

export interface QaStep {
  stepId: string;
  taskId?: string;
  scenarioId?: string;
  observationId?: string;
  thoughtSummary?: string;
  confidence?: number;
  action: QaAction;
  resolvedAction: QaAction;
  boundExpected: BoundExpectedAfterAction;
  validation?: AssertionResult;
  recoveryApplied?: QaAction;
  error?: { code: RuntimeErrorCode; message: string };
  quiescence?: QuiescenceResult;
  startedAt?: string;
  finishedAt?: string;
}

export interface QaTask {
  id: string;
  title: string;
  expected: string;
  status: 'PENDING' | 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
  dependsOn?: string[];
  intent?: ScenarioIntent;
  attempts?: AttemptRecord[];
}

export interface QaScenario {
  id: string;
  title: string;
  tasks: QaTask[];
  status: 'PLANNED' | 'RUNNING' | 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED' | 'PARTIAL' | 'BLOCKED';
  intent?: ScenarioIntent;
  preconditions?: string[];
}

export interface QaBug {
  bugId: string;
  stepId: string;
  scenarioId?: string;
  taskId?: string;
  classification: BugClassification;
  path: string;
  url?: string;
  expected?: string;
  actual?: string;
  signalType?: BugSignalType;
  rawMessage?: string;
  capturedAt: string;
}

export interface AttemptRecord {
  actionType: string;
  result: 'PASSED' | 'FAILED' | 'RECOVERED' | 'BLOCKED';
  reason?: string;
  ts: string;
}

export interface QaRunMetrics {
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  blockedScenarios: number;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  totalBugs: number;
  bugsBySeverity: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>;
  totalDurationMs: number;
  llmCalls?: number;
  sanitization?: Record<string, number>;
}

export interface ToolRuntimeInfo {
  enabled: boolean;
  usedTools: string[];
}

export interface MemoryRuntimeInfo {
  consulted: boolean;
  chunksReturned: number;
  query?: string;
  source?: 'tool' | 'service';
}

export interface QaRunResult {
  status: QaRunStatus;
  runDir: string;
  scenarios?: QaScenario[];
  steps: QaStep[];
  bugs?: QaBug[];
  metrics?: QaRunMetrics;
  startedAt?: string;
  finishedAt?: string;
  toolRuntime?: ToolRuntimeInfo;
  memoryRuntime?: MemoryRuntimeInfo;
}

export interface BugClassification {
  isBug: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: BugCategory;
  reason: string;
}
