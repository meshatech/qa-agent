import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { DemandContextSchema } from '../src/domain/schemas/demand-context.schema.js';
import { ClickUpHttpReaderAdapter } from '../src/infra/clickup/clickup-http-reader.adapter.js';

function makeClickUpResponse() {
  return {
    id: '12345',
    custom_id: 'PRJ-11366',
    name: '  Test Demand Title  ',
    description: 'Test description with <b>HTML</b> tags',
    text_content: 'Test description with <b>HTML</b> tags',
    status: { status: 'open', color: '#00FF00' },
    date_created: Date.now().toString(),
    date_updated: Date.now().toString(),
    creator: { id: 1, username: 'test', email: 'test@example.com', color: '#000000', profilePicture: '' },
    watchers: [],
    assignees: [],
    dependencies: [],
    tags: [],
    due_date: null,
    start_date: null,
    points: null,
    time_estimate: null,
    time_spent: null,
    list: { id: 'list-1', name: 'Test List' },
    folder: { id: 'folder-1', name: 'Test Folder' },
    space: { id: 'space-1', name: 'Test Space' },
    url: 'https://app.clickup.com/t/12345',
    attachments: [
      { id: 'att-1', url: 'https://example.com/file.pdf', title: 'spec.pdf', file_name: 'spec.pdf', thumbnail_large: null, thumbnail_medium: null, thumbnail_small: null },
    ],
    custom_fields: [],
    subtasks: [],
    checklists: [],
    linked_tasks: [],
    parent: null,
    priority: null,
    orderindex: '0',
    team_id: 'team-1',
    project: null,
    archived: false,
    markdown_description: 'Test description with <b>HTML</b> tags',
  };
}

describe('ClickUpHttpReaderAdapter (mocked API)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(makeClickUpResponse()),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('reads a ClickUp task into DemandContext with sanitized title and description', async () => {
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readConfiguredTask('fake-token', 'PRJ-11366', 'team-1');

    expect(DemandContextSchema.parse(result.demand).taskId.length).toBeGreaterThan(0);
    expect(result.demand.title.length).toBeGreaterThan(0);
    expect(result.demand.title).toBe(result.demand.title.trim());
    expect(result.demand.title).toBe('Test Demand Title');
    expect(result.demand.description).not.toMatch(/<[^>]+>/);
    expect(Array.isArray(result.demand.attachments)).toBe(true);
    expect(result.demand.attachments.length).toBe(1);
  });
});
