import { describe, expect, it } from 'vitest';

import { extractClickUpAcceptanceCriteria } from '../src/infra/clickup/clickup-acceptance-criteria.parser.js';
import { sanitizeClickUpDescription } from '../src/infra/clickup/clickup-task-content.mapper.js';

const PRJ_11368_DESCRIPTION = `PRJ-11368 — Extrair critérios de aceite por seção/texto
Descrição
Extrair critérios de aceite da descrição da task do ClickUp.
Uso Permitido
Identificar seções de critérios por regex/pattern.
Extrair lista numerada ou bullet points.
Critérios de Aceite
Critérios são extraídos da descrição.
Seções identificadas por padrões comuns.
Lista vazia quando não há critérios.`;

describe('extractClickUpAcceptanceCriteria', () => {
  it('extracts plain-line criteria from Critérios de Aceite section', () => {
    expect(extractClickUpAcceptanceCriteria(PRJ_11368_DESCRIPTION)).toEqual([
      'Critérios são extraídos da descrição.',
      'Seções identificadas por padrões comuns.',
      'Lista vazia quando não há critérios.',
    ]);
  });

  it('extracts checkbox bullet criteria', () => {
    const description = `Critérios de Aceite
- [x] Título é extraído corretamente.
- [ ] Descrição é extraída e sanitizada.`;

    expect(extractClickUpAcceptanceCriteria(description)).toEqual([
      'Título é extraído corretamente.',
      'Descrição é extraída e sanitizada.',
    ]);
  });

  it('extracts numbered criteria from Acceptance Criteria section', () => {
    const description = `Acceptance Criteria:
1. First criterion
2) Second criterion`;

    expect(extractClickUpAcceptanceCriteria(description)).toEqual([
      'First criterion',
      'Second criterion',
    ]);
  });

  it('returns empty list when no criteria section exists', () => {
    expect(extractClickUpAcceptanceCriteria('Descrição\nSome task text only.')).toEqual([]);
  });

  it('does not extract bullets from Uso Permitido section', () => {
    const description = `Uso Permitido
- Identificar seções de critérios por regex/pattern.
- Extrair lista numerada ou bullet points.
Descrição
Task body without criteria section.`;

    expect(extractClickUpAcceptanceCriteria(description)).toEqual([]);
  });

  it('works on sanitized HTML description text', () => {
    const html = `<p>Critérios de Aceite</p><ul><li>- [x] HTML criterion</li></ul>`;
    const sanitized = sanitizeClickUpDescription(html);

    expect(extractClickUpAcceptanceCriteria(sanitized)).toEqual(['HTML criterion']);
  });
});
