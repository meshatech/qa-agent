import { describe, expect, it } from 'vitest';

import { extractClickUpReproductionSteps } from '../src/infra/clickup/clickup-reproduction-steps.parser.js';
import { sanitizeClickUpDescription } from '../src/infra/clickup/clickup-task-content.mapper.js';

const PRJ_11369_DESCRIPTION = `PRJ-11369 — Extrair passos de reprodução quando existirem
Descrição
Extrair passos de reprodução da descrição da task quando esta representa um bug.
Critérios de Aceite
Passos são extraídos quando existem.
Seção é identificada por padrões comuns.
Retorna vazio quando não há passos.`;

describe('extractClickUpReproductionSteps', () => {
  it('extracts numbered steps from Passos para Reproduzir section', () => {
    const description = `Passos para Reproduzir
1. Abrir a tela de login
2) Preencher credenciais inválidas
3. Clicar em Entrar`;

    expect(extractClickUpReproductionSteps(description)).toEqual([
      'Abrir a tela de login',
      'Preencher credenciais inválidas',
      'Clicar em Entrar',
    ]);
  });

  it('extracts steps from Steps to Reproduce section', () => {
    const description = `Steps to Reproduce:
- Open login page
- Submit invalid credentials`;

    expect(extractClickUpReproductionSteps(description)).toEqual([
      'Open login page',
      'Submit invalid credentials',
    ]);
  });

  it('extracts plain-line steps from Passos de Reprodução section', () => {
    const description = `Passos de Reprodução
Abrir o formulário
Enviar dados inválidos
Verificar mensagem de erro`;

    expect(extractClickUpReproductionSteps(description)).toEqual([
      'Abrir o formulário',
      'Enviar dados inválidos',
      'Verificar mensagem de erro',
    ]);
  });

  it('returns empty list when no reproduction section exists', () => {
    expect(extractClickUpReproductionSteps(PRJ_11369_DESCRIPTION)).toEqual([]);
  });

  it('does not extract bullets from Critérios de Aceite section', () => {
    const description = `Critérios de Aceite
- Passos são extraídos quando existem.
- Seção é identificada por padrões comuns.
Descrição
Task body without reproduction section.`;

    expect(extractClickUpReproductionSteps(description)).toEqual([]);
  });

  it('works on sanitized HTML description text', () => {
    const html = `<p>Passos para Reproduzir</p><ul><li>1. Open app</li></ul>`;
    const sanitized = sanitizeClickUpDescription(html);

    expect(extractClickUpReproductionSteps(sanitized)).toEqual(['Open app']);
  });
});
