import { readFile } from 'node:fs/promises';

type GitHubPullRequestEvent = {
  pull_request?: { number?: number };
  number?: number;
};

export type GitHubActionsPrRefs = {
  prNumber: number;
  baseBranch: string;
  headBranch: string;
};

export function resolveBaseBranchFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const baseBranch = env.GITHUB_BASE_REF?.trim() ?? '';
  return baseBranch.length > 0 ? baseBranch : undefined;
}

export function resolveHeadBranchFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const headBranch = env.GITHUB_HEAD_REF?.trim() ?? '';
  return headBranch.length > 0 ? headBranch : undefined;
}

export async function resolvePullNumberFromEnv(
  env: NodeJS.ProcessEnv,
): Promise<number | undefined> {
  const fromRef = env.GITHUB_REF?.trim().match(/^refs\/pull\/(\d+)\//);
  if (fromRef) {
    return Number(fromRef[1]);
  }

  const fromEnv = env.GITHUB_PR_NUMBER?.trim();
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const eventPath = env.GITHUB_EVENT_PATH?.trim();
  if (!eventPath) {
    return undefined;
  }

  try {
    const raw = await readFile(eventPath, 'utf8');
    const event = JSON.parse(raw) as GitHubPullRequestEvent;
    const num = event.pull_request?.number ?? event.number;
    return typeof num === 'number' ? num : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveGitHubActionsPrRefs(
  env: NodeJS.ProcessEnv,
): Promise<GitHubActionsPrRefs | undefined> {
  const baseBranch = resolveBaseBranchFromEnv(env);
  const headBranch = resolveHeadBranchFromEnv(env);
  const prNumber = await resolvePullNumberFromEnv(env);

  if (!baseBranch || !headBranch || !prNumber || prNumber <= 0) {
    return undefined;
  }

  return { prNumber, baseBranch, headBranch };
}
