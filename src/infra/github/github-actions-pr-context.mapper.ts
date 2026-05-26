import { readFile } from 'node:fs/promises';
import { ZodError } from 'zod';

import { PrContextReaderError } from '../../domain/errors.js';
import {
  PullRequestContextSchema,
  type PullRequestContext,
} from '../../domain/schemas/pull-request-context.schema.js';

const ALLOWED_PR_EVENT_NAMES = ['pull_request', 'pull_request_target'] as const;

const GITHUB_TOKEN_ENV_KEYS = ['GITHUB_TOKEN', 'GH_TOKEN', 'INPUT_GITHUB_TOKEN'] as const;

type GitHubPullRequestEvent = {
  pull_request?: {
    number?: number;
    title?: string;
    user?: { login?: string };
  };
  number?: number;
};

export function resolveGitHubWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  return env.GITHUB_WORKSPACE?.trim() || process.cwd();
}

function sanitizePrContextErrorMessage(message: string, env: NodeJS.ProcessEnv): string {
  let sanitized = message;
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    const token = env[key]?.trim();
    if (token) {
      sanitized = sanitized.split(token).join('***REDACTED***');
    }
  }
  return sanitized;
}

function sanitizePrContextErrorCause(error: unknown, env: NodeJS.ProcessEnv): Error | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return new Error(sanitizePrContextErrorMessage(error.message, env));
}

async function resolvePullNumberFromEnv(env: NodeJS.ProcessEnv): Promise<number | undefined> {
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

async function readPullRequestMetadata(
  env: NodeJS.ProcessEnv,
): Promise<{ title: string; author: string }> {
  const eventPath = env.GITHUB_EVENT_PATH?.trim();
  if (!eventPath) {
    throw new PrContextReaderError(
      'GitHub Actions event payload is missing',
      sanitizePrContextErrorCause(new Error('GITHUB_EVENT_PATH is missing'), env),
      'INVALID_EVENT',
    );
  }

  try {
    const raw = await readFile(eventPath, 'utf8');
    const event = JSON.parse(raw) as GitHubPullRequestEvent;
    const title = event.pull_request?.title?.trim();
    const author = event.pull_request?.user?.login?.trim();

    if (!title || !author) {
      throw new PrContextReaderError(
        'GitHub Actions pull request metadata is incomplete',
        sanitizePrContextErrorCause(
          new Error('GitHub Actions pull request metadata is incomplete'),
          env,
        ),
        'INVALID_EVENT',
      );
    }

    return { title, author };
  } catch (error) {
    if (error instanceof PrContextReaderError) {
      throw error;
    }

    throw new PrContextReaderError(
      'GitHub Actions event payload is invalid',
      sanitizePrContextErrorCause(new Error('GitHub Actions event payload is invalid'), env),
      'INVALID_EVENT',
    );
  }
}

export async function mapGitHubActionsToPullRequestContext(
  options?: { env?: NodeJS.ProcessEnv },
): Promise<PullRequestContext> {
  const env = options?.env ?? process.env;
  const eventName = env.GITHUB_EVENT_NAME?.trim() ?? '';

  if (!ALLOWED_PR_EVENT_NAMES.includes(eventName as (typeof ALLOWED_PR_EVENT_NAMES)[number])) {
    throw new PrContextReaderError(
      'GitHub Actions PR event context is missing or invalid',
      sanitizePrContextErrorCause(
        new Error('GitHub Actions PR event context is missing or invalid'),
        env,
      ),
      'MISSING_CONTEXT',
    );
  }

  const baseBranch = env.GITHUB_BASE_REF?.trim() ?? '';
  const headBranch = env.GITHUB_HEAD_REF?.trim() ?? '';
  const gitRef = env.GITHUB_REF?.trim() ?? '';

  if (!gitRef) {
    throw new PrContextReaderError(
      'GitHub Actions PR context is incomplete',
      sanitizePrContextErrorCause(new Error('GITHUB_REF is missing'), env),
      'MISSING_CONTEXT',
    );
  }

  if (!baseBranch) {
    throw new PrContextReaderError(
      'GitHub Actions PR context is incomplete',
      sanitizePrContextErrorCause(new Error('GITHUB_BASE_REF is missing'), env),
      'MISSING_CONTEXT',
    );
  }

  if (!headBranch) {
    throw new PrContextReaderError(
      'GitHub Actions PR context is incomplete',
      sanitizePrContextErrorCause(new Error('GITHUB_HEAD_REF is missing'), env),
      'MISSING_CONTEXT',
    );
  }

  const prNumber = await resolvePullNumberFromEnv(env);
  if (!prNumber || prNumber <= 0) {
    throw new PrContextReaderError(
      'GitHub Actions pull request number is missing',
      sanitizePrContextErrorCause(new Error('GitHub Actions pull request number is missing'), env),
      'MISSING_CONTEXT',
    );
  }

  const { title, author } = await readPullRequestMetadata(env);

  try {
    return PullRequestContextSchema.parse({
      prNumber,
      baseBranch,
      headBranch,
      title,
      author,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      throw new PrContextReaderError(
        'GitHub Actions pull request context validation failed',
        sanitizePrContextErrorCause(
          new Error('GitHub Actions pull request context validation failed'),
          env,
        ),
        'VALIDATION_FAILED',
      );
    }
    throw error;
  }
}
