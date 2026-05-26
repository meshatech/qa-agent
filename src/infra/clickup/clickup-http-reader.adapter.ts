import { Injectable } from '@nestjs/common';

import type {
  ClickUpReaderPort,
  ClickUpTaskReadResult,
} from '../../application/ports/clickup-reader.port.js';
import { ClickUpReaderError } from '../../domain/errors.js';
import { BugContextSchema } from '../../domain/schemas/bug-context.schema.js';
import { DemandContextSchema } from '../../domain/schemas/demand-context.schema.js';
import {
  CLICKUP_RATE_LIMIT_MAX_WAIT_MS,
  CLICKUP_RATE_LIMIT_RETRIES,
  computeClickUpRetryWaitMs,
  mapClickUpHttpError,
  sanitizeClickUpErrorMessage,
  sleep,
} from './clickup-http-error.handler.js';
import { extractClickUpAcceptanceCriteria } from './clickup-acceptance-criteria.parser.js';
import { extractClickUpBugResults } from './clickup-bug-results.parser.js';
import { extractClickUpReproductionSteps } from './clickup-reproduction-steps.parser.js';
import {
  extractClickUpDescription,
  extractClickUpTitle,
} from './clickup-task-content.mapper.js';
import {
  mapClickUpTaskAttachments,
  type ClickUpTaskAttachmentSource,
} from './clickup-task-attachments.mapper.js';
import { resolveClickUpTaskId } from './clickup-task-id.resolver.js';
import { resolveClickUpTeamId } from './clickup-team-id.resolver.js';
import { buildClickUpTaskUrl, isCustomClickUpTaskId } from './clickup-task-url.builder.js';

const PRIORITY_BY_ID: Record<string, string> = {
  '1': 'urgent',
  '2': 'high',
  '3': 'normal',
  '4': 'low',
};

interface ClickUpTaskResponse {
  id: string;
  custom_id?: string | null;
  name: string;
  description?: string;
  text_content?: string;
  status?: { status?: string };
  assignees?: Array<{ username?: string | null }>;
  priority?: { id?: string | number | null; priority?: string | null } | null;
  due_date?: string | number | null;
  attachments?: ClickUpTaskAttachmentSource[];
}

@Injectable()
export class ClickUpHttpReaderAdapter implements ClickUpReaderPort {
  async readTask(
    taskId: string,
    token: string,
    options?: { configTeamId?: string },
  ): Promise<ClickUpTaskReadResult> {
    const response = await this.fetchTask(taskId, token, options?.configTeamId);
    const payload = (await response.json()) as ClickUpTaskResponse;

    const description = extractClickUpDescription(payload);

    const demand = DemandContextSchema.parse({
      taskId: payload.custom_id?.trim() || payload.id,
      title: extractClickUpTitle(payload.name),
      description,
      acceptanceCriteria: extractClickUpAcceptanceCriteria(description),
      attachments: mapClickUpTaskAttachments(payload.attachments),
      status: payload.status?.status?.trim() || 'unknown',
      assignees: (payload.assignees ?? [])
        .map((assignee) => assignee.username?.trim())
        .filter((username): username is string => Boolean(username)),
      priority: mapPriority(payload.priority),
      dueDate: mapDueDate(payload.due_date),
    });

    const reproductionSteps = extractClickUpReproductionSteps(description);
    const { expectedResult, actualResult } = extractClickUpBugResults(description);
    const result: ClickUpTaskReadResult = { demand };

    const hasBugContext =
      reproductionSteps.length > 0 || expectedResult !== null || actualResult !== null;

    if (hasBugContext) {
      result.bug = BugContextSchema.parse({
        reproductionSteps,
        expectedResult,
        actualResult,
      });
    }

    return result;
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

function mapPriority(
  priority: ClickUpTaskResponse['priority'],
): string | null {
  if (!priority) {
    return null;
  }

  if (typeof priority.priority === 'string' && priority.priority.trim().length > 0) {
    return priority.priority.trim();
  }

  if (priority.id != null) {
    return PRIORITY_BY_ID[String(priority.id)] ?? String(priority.id);
  }

  return null;
}

function mapDueDate(dueDate: ClickUpTaskResponse['due_date']): string | null {
  if (dueDate == null || dueDate === '') {
    return null;
  }

  const timestamp = typeof dueDate === 'number' ? dueDate : Number(dueDate);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return new Date(timestamp).toISOString();
}
