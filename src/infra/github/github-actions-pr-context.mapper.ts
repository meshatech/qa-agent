import { readFile } from 'node:fs/promises';
import { ZodError } from 'zod';

import { PrContextReaderError } from '../../domain/errors.js';
import {
  PullRequestContextSchema,
  type PullRequestContext,
} from '../../domain/schemas/pull-request-context.schema.js';
import { extractClickUpTaskIdFromPullRequestText, resolveClickUpCustomIdPattern } from './clickup-task-id-from-pr.resolver.js';
import { resolveGitHubActionsPrRefs, resolveHeadBranchFromEnv, resolveBaseBranchFromEnv } from './github-actions-pr-refs.resolver.js';

const ALLOWED_PR_EVENT_NAMES = ['pull_request', 'pull_request_target'] as const;

const GITHUB_TOKEN_ENV_KEYS = ['GITHUB_TOKEN', 'GH_TOKEN', 'INPUT_GITHUB_TOKEN'] as const;

type GitHubPullRequestEvent = {
  pull_request?: {
    title?: string;
    body?: string | null;
    user?: { login?: string };
  };
};

export function resolveGitHubWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  return env.GITHUB_WORKSPACE?.trim() || process.cwd();
}

function sanitizePrContextErrorMessage(message: string, env: NodeJS.ProcessEnv): string {
  let sanitized = message.replace(/\/[^\s'"]+/g, '<redacted>');
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    const token = env[key]?.trim();
    if (token) {
      sanitized = sanitized.split(token).join('***REDACTED***');
    }
  }
  return sanitized;
}

export function sanitizePullRequestBodyForExtraction(body?: string): string | undefined {
  const trimmed = body?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, 10000);
}

export { sanitizePrContextErrorMessage };

function sanitizePrContextErrorCause(error: unknown, env: NodeJS.ProcessEnv): Error | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return new Error(sanitizePrContextErrorMessage(error.message, env));
}

async function readGitHubPullRequestEvent(
  env: NodeJS.ProcessEnv,
): Promise<GitHubPullRequestEvent> {
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
    return JSON.parse(raw) as GitHubPullRequestEvent;
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

export async function extractClickUpTaskIdFromGitHubEvent(
  env: NodeJS.ProcessEnv = process.env,
  pattern: RegExp = resolveClickUpCustomIdPattern({ env }).pattern,
): Promise<string | undefined> {
  const eventPath = env.GITHUB_EVENT_PATH?.trim();
  if (!eventPath) {
    return undefined;
  }

  try {
    const event = await readGitHubPullRequestEvent(env);
    const title = event.pull_request?.title?.trim() ?? '';
    const body = event.pull_request?.body?.trim() || undefined;
    if (!title) {
      return undefined;
    }
    const safeBody = sanitizePullRequestBodyForExtraction(body);
    return extractClickUpTaskIdFromPullRequestText(title, safeBody, pattern);
  } catch {
    return undefined;
  }
}

async function readPullRequestMetadata(
  env: NodeJS.ProcessEnv,
): Promise<{ title: string; author: string; body?: string }> {
  const event = await readGitHubPullRequestEvent(env);
  const title = event.pull_request?.title?.trim();
  const author = event.pull_request?.user?.login?.trim();
  const body = sanitizePullRequestBodyForExtraction(event.pull_request?.body?.trim() || undefined);

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

  return { title, author, body };
}

function missingContextError(
  env: NodeJS.ProcessEnv,
  message: string,
): PrContextReaderError {
  return new PrContextReaderError(
    'GitHub Actions PR context is incomplete',
    sanitizePrContextErrorCause(new Error(message), env),
    'MISSING_CONTEXT',
  );
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

  const gitRef = env.GITHUB_REF?.trim() ?? '';
  if (!gitRef) {
    throw missingContextError(env, 'GITHUB_REF is missing');
  }

  const prRefs = await resolveGitHubActionsPrRefs(env);
  if (!prRefs) {
    if (!resolveBaseBranchFromEnv(env)) {
      throw missingContextError(env, 'GITHUB_BASE_REF is missing');
    }
    if (!resolveHeadBranchFromEnv(env)) {
      throw missingContextError(env, 'GITHUB_HEAD_REF is missing');
    }
    throw new PrContextReaderError(
      'GitHub Actions pull request number is missing',
      sanitizePrContextErrorCause(new Error('GitHub Actions pull request number is missing'), env),
      'MISSING_CONTEXT',
    );
  }

  const { title, author, body } = await readPullRequestMetadata(env);
  const { pattern } = resolveClickUpCustomIdPattern({ env });
  const clickUpTaskId = extractClickUpTaskIdFromPullRequestText(title, body, pattern);

  try {
    return PullRequestContextSchema.parse({
      ...prRefs,
      title,
      author,
      ...(clickUpTaskId ? { clickUpTaskId } : {}),
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
