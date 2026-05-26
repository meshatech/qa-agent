import type { ClickUpTaskReadResult } from '../../application/ports/clickup-reader.port.js';
import { BugContextSchema } from '../../domain/schemas/bug-context.schema.js';
import { DemandContextSchema } from '../../domain/schemas/demand-context.schema.js';
import { extractClickUpAcceptanceCriteria } from './clickup-acceptance-criteria.parser.js';
import { extractClickUpBugResults } from './clickup-bug-results.parser.js';
import { extractClickUpReproductionSteps } from './clickup-reproduction-steps.parser.js';
import { mapClickUpTaskAttachments } from './clickup-task-attachments.mapper.js';
import {
  extractClickUpDescription,
  extractClickUpTitle,
} from './clickup-task-content.mapper.js';
import type { ClickUpTaskPayload } from './clickup-task-response.schema.js';

const PRIORITY_BY_ID: Record<string, string> = {
  '1': 'urgent',
  '2': 'high',
  '3': 'normal',
  '4': 'low',
};

export type { ClickUpTaskPayload } from './clickup-task-response.schema.js';

export function mapClickUpTaskToReadResult(payload: ClickUpTaskPayload): ClickUpTaskReadResult {
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
    priority: mapClickUpPriority(payload.priority),
    dueDate: mapClickUpDueDate(payload.due_date),
  });

  const reproductionSteps = extractClickUpReproductionSteps(description);
  const { expectedResult, actualResult } = extractClickUpBugResults(description);
  const result: ClickUpTaskReadResult = { demand };

  const hasBugContext =
    reproductionSteps.length > 0 || expectedResult !== null || actualResult !== null;

  if (hasBugContext) {
    const bugParse = BugContextSchema.safeParse({
      reproductionSteps,
      expectedResult,
      actualResult,
    });
    if (bugParse.success) {
      result.bug = bugParse.data;
    }
  }

  return result;
}

function mapClickUpPriority(
  priority: ClickUpTaskPayload['priority'],
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

function mapClickUpDueDate(dueDate: ClickUpTaskPayload['due_date']): string | null {
  if (dueDate == null || dueDate === '') {
    return null;
  }

  const timestamp = typeof dueDate === 'number' ? dueDate : Number(dueDate);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return new Date(timestamp).toISOString();
}
