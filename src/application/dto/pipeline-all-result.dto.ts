export type PipelineAllStepStatus = 'OK' | 'BLOCKED' | 'BUGS_FOUND' | 'CONFIG_ERROR' | 'ERROR' | 'SKIPPED';

export interface PipelineAllStepRecord {
  name: string;
  status: PipelineAllStepStatus;
  exitCode: number;
  message?: string;
}

export interface PipelineAllRunResult {
  steps: PipelineAllStepRecord[];
  blockedAt?: string;
  exitCode: number;
  commentPosted?: boolean;
}
