import { Injectable } from '@nestjs/common';

import type {
  ClickUpReaderPort,
  ClickUpTaskReadResult,
} from '../../application/ports/clickup-reader.port.js';
import { ClickUpReaderError } from '../../domain/errors.js';
import { DemandContextSchema } from '../../domain/schemas/demand-context.schema.js';
import { extractClickUpAcceptanceCriteria } from './clickup-acceptance-criteria.parser.js';
import {
  extractClickUpDescription,
  extractClickUpTitle,
} from './clickup-task-content.mapper.js';
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
  attachments?: Array<{ title?: string; url?: string; mimetype?: string }>;
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
      attachments: (payload.attachments ?? [])
        .filter((attachment) => attachment.url && (attachment.title || attachment.mimetype))
        .map((attachment) => ({
          name: attachment.title?.trim() || 'attachment',
          url: attachment.url!,
          type: attachment.mimetype?.trim() || 'application/octet-stream',
        })),
      status: payload.status?.status?.trim() || 'unknown',
      assignees: (payload.assignees ?? [])
        .map((assignee) => assignee.username?.trim())
        .filter((username): username is string => Boolean(username)),
      priority: mapPriority(payload.priority),
      dueDate: mapDueDate(payload.due_date),
    });

    return { demand };
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
      const response = await fetch(url, {
        headers: { Authorization: token },
      });

      if (response.status === 401 || response.status === 403) {
        throw new ClickUpReaderError(
          `ClickUp read access denied (${response.status})`,
          response.status,
        );
      }

      if (response.status === 404) {
        throw new ClickUpReaderError(`ClickUp task not found (${taskId})`, response.status);
      }

      if (response.status === 429) {
        throw new ClickUpReaderError('ClickUp rate limit exceeded (429)', response.status);
      }

      if (!response.ok) {
        throw new ClickUpReaderError(`ClickUp API error (${response.status})`, response.status);
      }

      return response;
    } catch (error) {
      if (error instanceof ClickUpReaderError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new ClickUpReaderError(`ClickUp API request failed: ${message}`, undefined, error);
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
