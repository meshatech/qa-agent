import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  compileClickUpCustomIdPattern,
  extractClickUpTaskIdFromPullRequestText,
  INVALID_CUSTOM_ID_PATTERN_WARNING,
  resolveClickUpCustomIdPattern,
} from '../src/infra/github/clickup-task-id-from-pr.resolver.js';

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

  it('extracts using a custom regex pattern', () => {
    const { pattern } = compileClickUpCustomIdPattern('TASK-\\d+');
    expect(extractClickUpTaskIdFromPullRequestText('TASK-12345 — custom prefix', undefined, pattern)).toBe(
      'TASK-12345',
    );
  });

  it('returns the second valid match when the first candidate is invalid for the default pattern', () => {
    expect(extractClickUpTaskIdFromPullRequestText('FIX-123 PRJ-456')).toBe('PRJ-456');
  });

  it('returns undefined when matches exist but none pass custom ID validation', () => {
    expect(extractClickUpTaskIdFromPullRequestText('FIX-123 TASK-789')).toBeUndefined();
  });

  it('returns undefined when a custom pattern has no matches', () => {
    const { pattern } = compileClickUpCustomIdPattern('EPIC-\\d+');
    expect(extractClickUpTaskIdFromPullRequestText('PRJ-11552 — title', undefined, pattern)).toBeUndefined();
  });
});

describe('compileClickUpCustomIdPattern', () => {
  it('falls back to default PRJ-\\d+ and logs when pattern is invalid', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = compileClickUpCustomIdPattern('[PRJ-\\d+');

    expect(result.usedFallback).toBe(true);
    expect(result.invalidSource).toBe('[PRJ-\\d+');
    expect(
      extractClickUpTaskIdFromPullRequestText('PRJ-11552 — title', undefined, result.pattern),
    ).toBe('PRJ-11552');
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid CLICKUP_CUSTOM_ID_PATTERN, falling back to default PRJ-\\d+',
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it('falls back when pattern exceeds 100 characters', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const longPattern = 'P'.repeat(101);

    const result = compileClickUpCustomIdPattern(longPattern);

    expect(result.usedFallback).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid CLICKUP_CUSTOM_ID_PATTERN, falling back to default PRJ-\\d+',
      'pattern exceeds 100 characters',
    );

    warnSpy.mockRestore();
  });

  it('falls back when pattern is potentially unsafe (ReDoS)', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = compileClickUpCustomIdPattern('(a+)+');

    expect(result.usedFallback).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid CLICKUP_CUSTOM_ID_PATTERN, falling back to default PRJ-\\d+',
      'pattern is potentially unsafe (ReDoS)',
    );

    warnSpy.mockRestore();
  });

  it('falls back when pattern contains disallowed characters', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = compileClickUpCustomIdPattern('PRJ \\d+');

    expect(result.usedFallback).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid CLICKUP_CUSTOM_ID_PATTERN, falling back to default PRJ-\\d+',
      'pattern contains disallowed characters',
    );

    warnSpy.mockRestore();
  });

  it('accepts valid custom patterns', () => {
    expect(compileClickUpCustomIdPattern('TASK-\\d+').usedFallback).toBe(false);
    expect(compileClickUpCustomIdPattern('PRJ-\\d+').usedFallback).toBe(false);
  });
});

describe('resolveClickUpCustomIdPattern', () => {
  it('returns warning when env pattern is invalid', () => {
    const result = resolveClickUpCustomIdPattern({
      env: { CLICKUP_CUSTOM_ID_PATTERN: '[PRJ-\\d+' },
    });

    expect(result.usedFallback).toBe(true);
    expect(result.warning).toBe(INVALID_CUSTOM_ID_PATTERN_WARNING);
  });

  it('returns warning when config pattern is invalid', () => {
    const result = resolveClickUpCustomIdPattern({
      env: {},
      configPattern: '(a+)+',
    });

    expect(result.usedFallback).toBe(true);
    expect(result.warning).toBe(INVALID_CUSTOM_ID_PATTERN_WARNING);
  });
});
