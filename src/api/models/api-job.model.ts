export interface ApiJob {
  id: string;
  command: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  output?: string;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
