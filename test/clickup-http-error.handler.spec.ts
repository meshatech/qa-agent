import { describe, expect, it } from 'vitest';

import { ClickUpReaderError } from '../src/domain/errors.js';
import {
  CLICKUP_RATE_LIMIT_MAX_WAIT_MS,
  computeClickUpRetryWaitMs,
  mapClickUpHttpError,
  sanitizeClickUpErrorCause,
  sanitizeClickUpErrorMessage,
} from '../src/infra/clickup/clickup-http-error.handler.js';

describe('mapClickUpHttpError', () => {
  it('maps 401 to AUTH_FAILED', () => {
    const error = mapClickUpHttpError(401, 'PRJ-404');

    expect(error).toBeInstanceOf(ClickUpReaderError);
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('ClickUp authentication failed (401)');
  });

  it('maps 403 to PERMISSION_DENIED', () => {
    const error = mapClickUpHttpError(403, 'PRJ-404');

    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('ClickUp permission denied (403)');
  });

  it('maps 404 to TASK_NOT_FOUND with task id in message', () => {
    const error = mapClickUpHttpError(404, 'PRJ-404');

    expect(error.code).toBe('TASK_NOT_FOUND');
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('ClickUp task not found (PRJ-404)');
  });

  it('maps 429 to RATE_LIMIT_EXCEEDED', () => {
    const error = mapClickUpHttpError(429, 'PRJ-404');

    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(error.statusCode).toBe(429);
    expect(error.message).toBe('ClickUp rate limit exceeded (429)');
  });

  it('maps unknown status to API_ERROR', () => {
    const error = mapClickUpHttpError(500, 'PRJ-404');

    expect(error.code).toBe('API_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe('ClickUp API error (500)');
  });
});

describe('sanitizeClickUpErrorMessage', () => {
  it('redacts known token and pk_ patterns', () => {
    const sanitized = sanitizeClickUpErrorMessage(
      'Authorization pk_secret123 failed for Bearer abc.def.ghi',
      'pk_secret123',
    );

    expect(sanitized).not.toContain('pk_secret123');
    expect(sanitized).not.toContain('Bearer abc.def.ghi');
    expect(sanitized).toContain('***REDACTED***');
  });
});

describe('sanitizeClickUpErrorCause', () => {
  it('returns a new Error with sanitized message', () => {
    const token = 'pk_secret123';
    const cause = sanitizeClickUpErrorCause(
      new Error(`Authorization ${token} failed`),
      token,
    );

    expect(cause).toBeInstanceOf(Error);
    expect(cause?.message).not.toContain(token);
    expect(cause?.message).toContain('***REDACTED***');
  });

  it('returns undefined for non-Error values', () => {
    expect(sanitizeClickUpErrorCause('network down', 'pk_test')).toBeUndefined();
  });
});

describe('computeClickUpRetryWaitMs', () => {
  it('uses Retry-After header when present', () => {
    const headers = new Headers({ 'retry-after': '2' });

    expect(computeClickUpRetryWaitMs(headers, 0, CLICKUP_RATE_LIMIT_MAX_WAIT_MS)).toBe(2000);
  });

  it('uses Retry-After header without capping at maxWaitMs', () => {
    const headers = new Headers({ 'retry-after': '120' });

    expect(computeClickUpRetryWaitMs(headers, 0, 5000)).toBe(120_000);
  });

  it('caps exponential fallback at maxWaitMs when Retry-After is absent', () => {
    const headers = new Headers();

    expect(computeClickUpRetryWaitMs(headers, 10, 5000)).toBe(5000);
  });

  it('falls back to exponential seconds when Retry-After is absent', () => {
    const headers = new Headers();

    expect(computeClickUpRetryWaitMs(headers, 2, CLICKUP_RATE_LIMIT_MAX_WAIT_MS)).toBe(4000);
  });
});
