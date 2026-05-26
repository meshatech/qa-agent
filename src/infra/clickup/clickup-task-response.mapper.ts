import { Logger } from '@nestjs/common';
import type { ClickUpTaskReadResult } from '../../application/ports/clickup-reader.port.js';
import { BugContextSchema, type BugContext } from '../../domain/schemas/bug-context.schema.js';
import { DemandContextSchema } from '../../domain/schemas/demand-context.schema.js';
import { z } from 'zod';
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

const ISO_8601_DUE_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

const logger = new Logger('ClickUpTaskResponseMapper');

const ClickUpBugResultFieldSchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

export type { ClickUpTaskPayload } from './clickup-task-response.schema.js';

function buildClickUpBugContext(
  reproductionSteps: string[],
  expectedResult: string | null,
  actualResult: string | null,
): BugContext | null {
  const normalizedSteps = reproductionSteps
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
  const normalizedExpected = ClickUpBugResultFieldSchema.parse(expectedResult);
  const normalizedActual = ClickUpBugResultFieldSchema.parse(actualResult);

  const hasBugContext =
    normalizedSteps.length > 0 ||
    normalizedExpected !== null ||
    normalizedActual !== null;

  if (!hasBugContext) {
    return null;
  }

  return BugContextSchema.parse({
    reproductionSteps: normalizedSteps,
    expectedResult: normalizedExpected,
    actualResult: normalizedActual,
  });
}

export function mapClickUpTaskToReadResult(payload: ClickUpTaskPayload): ClickUpTaskReadResult {
  const description = extractClickUpDescription(payload);
  const warnings: string[] = [];
  const { attachments, warnings: attachmentWarnings } = mapClickUpTaskAttachments(
    payload.attachments,
  );
  warnings.push(...attachmentWarnings);

  const demand = DemandContextSchema.parse({
    taskId: payload.custom_id?.trim() || payload.id,
    title: extractClickUpTitle(payload.name),
    description,
    acceptanceCriteria: extractClickUpAcceptanceCriteria(description),
    attachments,
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

  const bug = buildClickUpBugContext(reproductionSteps, expectedResult, actualResult);
  if (bug) {
    result.bug = bug;
  }

  if (warnings.length > 0) {
    result.warnings = warnings;
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

  if (typeof dueDate === 'string') {
    const trimmed = dueDate.trim();
    if (ISO_8601_DUE_DATE_PREFIX.test(trimmed)) {
      return trimmed;
    }
  }

  const timestamp = typeof dueDate === 'number' ? dueDate : Number(dueDate);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp).toISOString();
  }

  logger.warn('ClickUp due date ignored due to unsupported format');
  return null;
}
