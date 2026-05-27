import { config as loadEnv } from 'dotenv';
import { describe, expect, it } from 'vitest';

import { DemandContextSchema } from '../src/domain/schemas/demand-context.schema.js';
import { ClickUpHttpReaderAdapter } from '../src/infra/clickup/clickup-http-reader.adapter.js';

loadEnv();

const INTEGRATION_TASK_ID = 'PRJ-11366';
const hasClickUpEnv = Boolean(
  process.env.CLICKUP_TOKEN?.trim() && process.env.CLICKUP_TEAM_ID?.trim(),
);

describe.runIf(hasClickUpEnv)('ClickUpHttpReaderAdapter real API', () => {
  it('reads a real ClickUp task into DemandContext with sanitized title and description', async () => {
    const reader = new ClickUpHttpReaderAdapter();
    const token = process.env.CLICKUP_TOKEN!.trim();
    const teamId = process.env.CLICKUP_TEAM_ID!.trim();

    const result = await reader.readConfiguredTask(token, INTEGRATION_TASK_ID, teamId);

    expect(DemandContextSchema.parse(result.demand).taskId.length).toBeGreaterThan(0);
    expect(result.demand.title.length).toBeGreaterThan(0);
    expect(result.demand.title).toBe(result.demand.title.trim());
    expect(result.demand.description).not.toMatch(/<[^>]+>/);
    expect(Array.isArray(result.demand.attachments)).toBe(true);
  });
});
