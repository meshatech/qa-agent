export interface PipelineAllSummaryInput {
  steps: Array<{ name: string; status: string }>;
  blockedAt?: string;
}

export function formatPipelineAllSummary(result: PipelineAllSummaryInput): string {
  const parts = result.steps.map((step) => `${step.name}=${step.status}`);
  const stopped = result.blockedAt ? ` (stopped at ${result.blockedAt})` : '';
  return `[pipeline all] ${parts.join(' ')}${stopped}`;
}
