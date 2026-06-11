import type { ExitCode } from '../../interfaces/cli/exit-codes.js';

export type PipelineAllStepStatus = 'OK' | 'BLOCKED' | 'BUGS_FOUND' | 'CONFIG_ERROR' | 'ERROR' | 'SKIPPED';

export interface PipelineAllStepRecord {
  name: string;
  status: PipelineAllStepStatus;
  exitCode: ExitCode;
  message?: string;
}

export interface PipelineAllRunResult {
  steps: PipelineAllStepRecord[];
  blockedAt?: string;
  exitCode: ExitCode;
  commentPosted?: boolean;
}
