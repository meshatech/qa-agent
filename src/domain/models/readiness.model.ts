export type ProjectReadinessStatus = 'READY' | 'ONBOARDING_BLOCKED' | 'UNKNOWN';

export interface OnboardingResult {
  readiness: ProjectReadinessStatus;
  baselineReportPath: string | null;
  warnings: string[];
}
