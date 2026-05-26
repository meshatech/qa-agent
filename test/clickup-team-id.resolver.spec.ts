import { describe, expect, it } from 'vitest';

import { ClickUpReaderError } from '../src/domain/errors.js';
import { resolveClickUpTeamId } from '../src/infra/clickup/clickup-team-id.resolver.js';

describe('resolveClickUpTeamId', () => {
  it('returns CLICKUP_TEAM_ID from environment', () => {
    expect(
      resolveClickUpTeamId({
        env: { CLICKUP_TEAM_ID: '459806' },
      }),
    ).toBe('459806');
  });

  it('trims whitespace from environment value', () => {
    expect(
      resolveClickUpTeamId({
        env: { CLICKUP_TEAM_ID: '  459806  ' },
      }),
    ).toBe('459806');
  });

  it('falls back to config teamId when env is missing', () => {
    expect(
      resolveClickUpTeamId({
        env: {},
        configTeamId: '459806',
      }),
    ).toBe('459806');
  });

  it('prefers environment over config when both are set', () => {
    expect(
      resolveClickUpTeamId({
        env: { CLICKUP_TEAM_ID: '111111' },
        configTeamId: '459806',
      }),
    ).toBe('111111');
  });

  it('returns undefined when not required and env/config are empty', () => {
    expect(
      resolveClickUpTeamId({
        env: {},
      }),
    ).toBeUndefined();
  });

  it('throws ClickUpReaderError when required and env/config are empty', () => {
    expect(() =>
      resolveClickUpTeamId({
        env: {},
        required: true,
      }),
    ).toThrow(ClickUpReaderError);

    expect(() =>
      resolveClickUpTeamId({
        env: { CLICKUP_TEAM_ID: '   ' },
        required: true,
      }),
    ).toThrow(/CLICKUP_TEAM_ID is missing or empty/);
  });
});
