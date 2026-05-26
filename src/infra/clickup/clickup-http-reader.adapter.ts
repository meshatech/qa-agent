import { Injectable } from '@nestjs/common';
import { ZodError } from 'zod';

import type {
  ClickUpReaderPort,
  ClickUpTaskReadResult,
} from '../../application/ports/clickup-reader.port.js';
import { ClickUpReaderError } from '../../domain/errors.js';
import {
  CLICKUP_RATE_LIMIT_MAX_WAIT_MS,
  CLICKUP_RATE_LIMIT_RETRIES,
  computeClickUpRetryWaitMs,
  mapClickUpHttpError,
  sanitizeClickUpErrorCause,
  sanitizeClickUpErrorMessage,
  sleep,
} from './clickup-http-error.handler.js';
import { mapClickUpTaskToReadResult } from './clickup-task-response.mapper.js';
import { ClickUpTaskResponseSchema } from './clickup-task-response.schema.js';
import { resolveClickUpTaskId } from './clickup-task-id.resolver.js';
import { resolveClickUpTeamId } from './clickup-team-id.resolver.js';
import { buildClickUpTaskUrl, isCustomClickUpTaskId } from './clickup-task-url.builder.js';

const CLICKUP_REQUEST_TIMEOUT_MS = 30_000;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function scheduleClickUpRequestTimeout(controller: AbortController): ReturnType<typeof setTimeout> {
  return setTimeout(() => controller.abort(), CLICKUP_REQUEST_TIMEOUT_MS);
}

@Injectable()
export class ClickUpHttpReaderAdapter implements ClickUpReaderPort {
  async readTask(
    taskId: string,
    token: string,
    options?: { configTeamId?: string },
  ): Promise<ClickUpTaskReadResult> {
    const response = await this.fetchTask(taskId, token, options?.configTeamId);
    try {
      const raw: unknown = await response.json();
      const payload = ClickUpTaskResponseSchema.parse(raw);
      return mapClickUpTaskToReadResult(payload);
    } catch (error) {
      if (error instanceof ClickUpReaderError) {
        throw error;
      }
      if (error instanceof ZodError) {
        throw new ClickUpReaderError(
          sanitizeClickUpErrorMessage('ClickUp API returned an invalid task payload', token),
          undefined,
          sanitizeClickUpErrorCause(
            new Error('ClickUp API returned an invalid task payload'),
            token,
          ),
          'API_ERROR',
        );
      }
      throw error;
    }
  }

  async readConfiguredTask(
    token: string,
    configTaskId?: string,
    configTeamId?: string,
  ): Promise<ClickUpTaskReadResult> {
    const taskId = resolveClickUpTaskId({ configTaskId });
    return this.readTask(taskId, token, { configTeamId });
  }

  private async fetchTask(
    taskId: string,
    token: string,
    configTeamId?: string,
  ): Promise<Response> {
    const controller = new AbortController();
    let timeoutId = scheduleClickUpRequestTimeout(controller);

    try {
      const teamId = isCustomClickUpTaskId(taskId)
        ? resolveClickUpTeamId({ configTeamId, required: true })
        : resolveClickUpTeamId({ configTeamId });
      const url = buildClickUpTaskUrl(taskId, { teamId });

      for (let attempt = 0; attempt <= CLICKUP_RATE_LIMIT_RETRIES; attempt += 1) {
        const response = await fetch(url, {
          headers: { Authorization: token },
          signal: controller.signal,
        });

        if (response.status === 429 && attempt < CLICKUP_RATE_LIMIT_RETRIES) {
          clearTimeout(timeoutId);
          await sleep(
            computeClickUpRetryWaitMs(
              response.headers,
              attempt,
              CLICKUP_RATE_LIMIT_MAX_WAIT_MS,
            ),
          );
          timeoutId = scheduleClickUpRequestTimeout(controller);
          continue;
        }

        if (!response.ok) {
          throw mapClickUpHttpError(response.status, taskId, token);
        }

        return response;
      }

      throw mapClickUpHttpError(429, taskId, token);
    } catch (error) {
      if (error instanceof ClickUpReaderError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new ClickUpReaderError(
          sanitizeClickUpErrorMessage('ClickUp API request timed out', token),
          undefined,
          sanitizeClickUpErrorCause(new Error('ClickUp API request timed out'), token),
          'REQUEST_FAILED',
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new ClickUpReaderError(
        sanitizeClickUpErrorMessage(`ClickUp API request failed: ${message}`, token),
        undefined,
        sanitizeClickUpErrorCause(error, token),
        'REQUEST_FAILED',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
