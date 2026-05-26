import { config as loadEnv } from 'dotenv';
import { describe, expect, it } from 'vitest';

import { DemandContextSchema } from '../src/domain/schemas/demand-context.schema.js';
import { ClickUpHttpReaderAdapter } from '../src/infra/clickup/clickup-http-reader.adapter.js';
import { isCustomClickUpTaskId } from '../src/infra/clickup/clickup-task-url.builder.js';

loadEnv();

const taskId = process.env.CLICKUP_TASK_ID?.trim() ?? '';
const hasClickUpEnv = Boolean(
  process.env.CLICKUP_TOKEN?.trim() &&
    taskId &&
    (!isCustomClickUpTaskId(taskId) || process.env.CLICKUP_TEAM_ID?.trim()),
);

describe.runIf(hasClickUpEnv)('ClickUpHttpReaderAdapter real API', () => {
  it('reads a real ClickUp task into DemandContext with sanitized title and description', async () => {
    const reader = new ClickUpHttpReaderAdapter();
    const token = process.env.CLICKUP_TOKEN!.trim();

    const result = await reader.readTask(taskId, token);

    expect(DemandContextSchema.parse(result.demand).taskId.length).toBeGreaterThan(0);
    expect(result.demand.title.length).toBeGreaterThan(0);
    expect(result.demand.title).toBe(result.demand.title.trim());
    expect(result.demand.description).not.toMatch(/<[^>]+>/);
  });
});
