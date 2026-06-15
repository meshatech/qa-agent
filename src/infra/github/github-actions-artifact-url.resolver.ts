/**
 * Resolves GitHub Actions artifact URLs from environment variables.
 * When running inside GitHub Actions, GITHUB_REPOSITORY and GITHUB_RUN_ID
 * are automatically available.
 */

export interface GitHubActionsRunContext {
  repository: string;
  runId: string;
  serverUrl: string;
  workflow?: string;
}

export function resolveGitHubActionsRunContext(
  env: NodeJS.ProcessEnv = process.env,
): GitHubActionsRunContext | undefined {
  const repository = env.GITHUB_REPOSITORY?.trim() ?? '';
  const runId = env.GITHUB_RUN_ID?.trim() ?? '';
  const serverUrl = env.GITHUB_SERVER_URL?.trim() ?? 'https://github.com';

  if (!repository || !runId) return undefined;

  return { repository, runId, serverUrl };
}

export function buildArtifactsPageUrl(context: GitHubActionsRunContext): string {
  return `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}#artifacts`;
}

export function buildArtifactDownloadUrl(
  context: GitHubActionsRunContext,
  artifactName: string,
): string {
  return `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}/artifacts?artifactName=${encodeURIComponent(artifactName)}`;
}
