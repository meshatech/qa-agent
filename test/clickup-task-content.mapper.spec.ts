import { describe, expect, it } from 'vitest';

import {
  extractClickUpDescription,
  extractClickUpTitle,
  sanitizeClickUpDescription,
} from '../src/infra/clickup/clickup-task-content.mapper.js';

describe('extractClickUpTitle', () => {
  it('trims whitespace from task name', () => {
    expect(extractClickUpTitle('  Criar ClickUpReaderPort  ')).toBe('Criar ClickUpReaderPort');
  });

  it('keeps a clean title unchanged', () => {
    expect(extractClickUpTitle('Ler título')).toBe('Ler título');
  });

  it('trims tabs and newlines around the title', () => {
    expect(extractClickUpTitle('\n\t Ler título \t\n')).toBe('Ler título');
  });
});

describe('extractClickUpDescription', () => {
  it('prefers description over text_content', () => {
    expect(
      extractClickUpDescription({
        description: '<p>from description</p>',
        text_content: 'from text content',
      }),
    ).toBe('from description');
  });

  it('falls back to text_content when description is missing', () => {
    expect(
      extractClickUpDescription({
        text_content: 'plain text content',
      }),
    ).toBe('plain text content');
  });

  it('returns empty string when both fields are missing', () => {
    expect(extractClickUpDescription({})).toBe('');
  });
});

describe('sanitizeClickUpDescription', () => {
  it('strips HTML tags and preserves block breaks', () => {
    expect(sanitizeClickUpDescription('<p>foo</p><br/>bar')).toBe('foo\nbar');
  });

  it('decodes common HTML entities', () => {
    expect(sanitizeClickUpDescription('Tom &amp; Jerry&nbsp;test')).toBe('Tom & Jerry test');
  });

  it('decodes numeric HTML entities', () => {
    expect(sanitizeClickUpDescription('A&#65;')).toBe('AA');
  });

  it('does not truncate long descriptions', () => {
    const longText = `<p>${'x'.repeat(5000)}</p>`;
    const sanitized = sanitizeClickUpDescription(longText);

    expect(sanitized).toBe('x'.repeat(5000));
    expect(sanitized.length).toBe(5000);
  });
});
