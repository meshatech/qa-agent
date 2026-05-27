import { describe, expect, it } from 'vitest';

import { extractClickUpTaskIdFromPullRequestText } from '../src/infra/github/clickup-task-id-from-pr.resolver.js';

describe('extractClickUpTaskIdFromPullRequestText', () => {
  it('extracts task ID from PR title when present', () => {
    expect(
      extractClickUpTaskIdFromPullRequestText('PRJ-11550 — Orquestrar pipeline prepare'),
    ).toBe('PRJ-11550');
  });

  it('falls back to PR body when title has no task ID', () => {
    expect(
      extractClickUpTaskIdFromPullRequestText('Fix login flow', 'Related to PRJ-11392'),
    ).toBe('PRJ-11392');
  });

  it('returns the first valid task ID when multiple IDs appear in the title', () => {
    expect(extractClickUpTaskIdFromPullRequestText('PRJ-11552 fix PRJ-99999')).toBe('PRJ-11552');
  });

  it('returns undefined when no task ID is present in title or body', () => {
    expect(extractClickUpTaskIdFromPullRequestText('Fix login flow', 'No custom id here')).toBeUndefined();
  });

  it('rejects lowercase custom IDs', () => {
    expect(extractClickUpTaskIdFromPullRequestText('prj-11552 — lowercase')).toBeUndefined();
  });
});
