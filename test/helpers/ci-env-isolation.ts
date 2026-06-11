/** Env vars commonly injected by GitHub Actions / local .env that must not leak into unit tests. */
export const CI_INJECTED_ENV_KEYS = [
  'AGENT_QA_CONFIG',
  'CI',
  'CLICKUP_TASK_ID',
  'CLICKUP_TOKEN',
  'GITHUB_ACTION',
  'GITHUB_ACTIONS',
  'GITHUB_ACTOR',
  'GITHUB_API_URL',
  'GITHUB_BASE_REF',
  'GITHUB_EVENT_NAME',
  'GITHUB_EVENT_PATH',
  'GITHUB_HEAD_REF',
  'GITHUB_PR_NUMBER',
  'GITHUB_REF',
  'GITHUB_REPOSITORY',
  'GITHUB_REPOSITORY_OWNER',
  'GITHUB_RUN_ID',
  'GITHUB_SHA',
  'GITHUB_TOKEN',
  'GITHUB_WORKFLOW',
  'GITHUB_WORKSPACE',
  'GH_TOKEN',
  'INPUT_GITHUB_TOKEN',
] as const;

export function clearCiInjectedEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of CI_INJECTED_ENV_KEYS) {
    delete env[key];
  }
}
