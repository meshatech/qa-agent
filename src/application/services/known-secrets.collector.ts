export const GITHUB_TOKEN_ENV_KEYS = ['GITHUB_TOKEN', 'GH_TOKEN', 'INPUT_GITHUB_TOKEN'] as const;

export function collectKnownSecretsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  extraSecrets: string[] = [],
): string[] {
  const unique = new Set<string>();

  for (const value of [
    env.CLICKUP_TOKEN,
    env.CLICKUP_API_TOKEN,
    env.CLICKUP_TASK_ID,
    ...GITHUB_TOKEN_ENV_KEYS.map((key) => env[key]),
    ...extraSecrets,
  ]) {
    const trimmed = value?.trim() ?? '';
    if (trimmed) unique.add(trimmed);
  }

  return [...unique];
}
