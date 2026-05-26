import {
  ClickUpReaderError,
  type ClickUpReaderErrorCode,
} from '../../domain/errors.js';

const MASK = '***REDACTED***';

const SECRET_PATTERNS = [
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /pk_[a-zA-Z0-9_-]{8,}/gi,
  /gh[pousr]_[a-zA-Z0-9_]{8,}/gi,
];

export const CLICKUP_RATE_LIMIT_RETRIES = 3;
export const CLICKUP_RATE_LIMIT_MAX_WAIT_MS = 30_000;

export function mapClickUpHttpError(
  status: number,
  taskId: string,
  token?: string,
): ClickUpReaderError {
  const mapping: Record<number, { code: ClickUpReaderErrorCode; message: string }> = {
    401: {
      code: 'AUTH_FAILED',
      message: 'ClickUp authentication failed (401)',
    },
    403: {
      code: 'PERMISSION_DENIED',
      message: 'ClickUp permission denied (403)',
    },
    404: {
      code: 'TASK_NOT_FOUND',
      message: `ClickUp task not found (${taskId})`,
    },
    429: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'ClickUp rate limit exceeded (429)',
    },
  };

  const mapped = mapping[status];
  if (mapped) {
    return new ClickUpReaderError(
      sanitizeClickUpErrorMessage(mapped.message, token),
      status,
      undefined,
      mapped.code,
    );
  }

  return new ClickUpReaderError(
    sanitizeClickUpErrorMessage(`ClickUp API error (${status})`, token),
    status,
    undefined,
    'API_ERROR',
  );
}

export function sanitizeClickUpErrorMessage(message: string, token?: string): string {
  let sanitized = SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, MASK),
    message,
  );

  const trimmedToken = token?.trim();
  if (trimmedToken) {
    sanitized = sanitized.split(trimmedToken).join(MASK);
  }

  return sanitized;
}

export function computeClickUpRetryWaitMs(
  headers: Headers,
  attempt: number,
  maxWaitMs: number,
): number {
  const retryAfter = Number(headers.get('retry-after'));
  const seconds =
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 10);

  return Math.min(Math.ceil(seconds * 1000), maxWaitMs);
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}
