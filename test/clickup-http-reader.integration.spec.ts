import { describe, expect, it } from 'vitest';

import { DemandContextSchema } from '../src/domain/schemas/demand-context.schema.js';
import { ClickUpHttpReaderAdapter } from '../src/infra/clickup/clickup-http-reader.adapter.js';

const hasClickUpEnv = Boolean(
  process.env.CLICKUP_TOKEN?.trim() && process.env.CLICKUP_TASK_ID?.trim(),
);

describe.runIf(hasClickUpEnv)('ClickUpHttpReaderAdapter real API', () => {
  it('reads a real ClickUp task into DemandContext', async () => {
    const reader = new ClickUpHttpReaderAdapter();
    const taskId = process.env.CLICKUP_TASK_ID!.trim();
    const token = process.env.CLICKUP_TOKEN!.trim();

    const result = await reader.readTask(taskId, token);

    expect(DemandContextSchema.parse(result.demand).taskId.length).toBeGreaterThan(0);
    expect(result.demand.title.length).toBeGreaterThan(0);
  });
});
