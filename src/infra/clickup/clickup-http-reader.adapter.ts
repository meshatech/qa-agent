import { Injectable } from '@nestjs/common';

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
  sanitizeClickUpErrorMessage,
  sleep,
} from './clickup-http-error.handler.js';
import {
  mapClickUpTaskToReadResult,
  type ClickUpTaskPayload,
} from './clickup-task-response.mapper.js';
import { resolveClickUpTaskId } from './clickup-task-id.resolver.js';
import { resolveClickUpTeamId } from './clickup-team-id.resolver.js';
import { buildClickUpTaskUrl, isCustomClickUpTaskId } from './clickup-task-url.builder.js';

@Injectable()
export class ClickUpHttpReaderAdapter implements ClickUpReaderPort {
  async readTask(
    taskId: string,
    token: string,
    options?: { configTeamId?: string },
  ): Promise<ClickUpTaskReadResult> {
    const response = await this.fetchTask(taskId, token, options?.configTeamId);
    const payload = (await response.json()) as ClickUpTaskPayload;
    return mapClickUpTaskToReadResult(payload);
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
    try {
      const teamId = isCustomClickUpTaskId(taskId)
        ? resolveClickUpTeamId({ configTeamId, required: true })
        : resolveClickUpTeamId({ configTeamId });
      const url = buildClickUpTaskUrl(taskId, { teamId });

      for (let attempt = 0; attempt <= CLICKUP_RATE_LIMIT_RETRIES; attempt += 1) {
        const response = await fetch(url, {
          headers: { Authorization: token },
        });

        if (response.status === 429 && attempt < CLICKUP_RATE_LIMIT_RETRIES) {
          await sleep(
            computeClickUpRetryWaitMs(
              response.headers,
              attempt,
              CLICKUP_RATE_LIMIT_MAX_WAIT_MS,
            ),
          );
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

      const message = error instanceof Error ? error.message : String(error);
      throw new ClickUpReaderError(
        sanitizeClickUpErrorMessage(`ClickUp API request failed: ${message}`, token),
        undefined,
        error,
        'REQUEST_FAILED',
      );
    }
  }
}
