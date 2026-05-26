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

  it('keeps a clean plain-text description unchanged', () => {
    expect(
      extractClickUpDescription({
        description: 'Ler descrição da task do ClickUp.',
      }),
    ).toBe('Ler descrição da task do ClickUp.');
  });

  it('sanitizes HTML while preserving readable description text', () => {
    expect(
      extractClickUpDescription({
        description: '<p>Passos para Reproduzir</p><p>Abrir o app</p>',
      }),
    ).toBe('Passos para Reproduzir\nAbrir o app');
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

  it('preserves anchor hrefs when stripping HTML tags', () => {
    expect(
      sanitizeClickUpDescription('<a href="https://link.com">clique aqui</a>'),
    ).toBe('clique aqui (https://link.com)');
  });

  it('preserves data-* attributes when stripping HTML tags', () => {
    expect(
      sanitizeClickUpDescription('<span data-task-id="123">Task ref</span>'),
    ).toBe('Task ref [data-task-id=123]');
  });
});
