import { describe, expect, it } from 'vitest';

import { extractClickUpBugResults } from '../src/infra/clickup/clickup-bug-results.parser.js';
import { sanitizeClickUpDescription } from '../src/infra/clickup/clickup-task-content.mapper.js';

describe('extractClickUpBugResults', () => {
  it('extracts expected and actual results from Portuguese sections', () => {
    const description = `Bug report
Resultado Esperado
Mensagem de erro de credenciais inválidas
Resultado Obtido
Tela em branco sem feedback`;

    expect(extractClickUpBugResults(description)).toEqual({
      expectedResult: 'Mensagem de erro de credenciais inválidas',
      actualResult: 'Tela em branco sem feedback',
    });
  });

  it('extracts expected and actual results from English sections', () => {
    const description = `Expected Result
User is authenticated
Actual Result
500 error page`;

    expect(extractClickUpBugResults(description)).toEqual({
      expectedResult: 'User is authenticated',
      actualResult: '500 error page',
    });
  });

  it('returns null actualResult when only expected section exists', () => {
    const description = `Resultado Esperado
Usuário autenticado com sucesso
Critérios de Aceite
Some criterion`;

    expect(extractClickUpBugResults(description)).toEqual({
      expectedResult: 'Usuário autenticado com sucesso',
      actualResult: null,
    });
  });

  it('returns null for both fields when result sections are absent', () => {
    expect(
      extractClickUpBugResults('Descrição\nTask body without bug result sections.'),
    ).toEqual({
      expectedResult: null,
      actualResult: null,
    });
  });

  it('does not treat Critérios de Aceite content as bug results', () => {
    const description = `Critérios de Aceite
Resultado esperado é extraído.
Resultado obtido é extraído.`;

    expect(extractClickUpBugResults(description)).toEqual({
      expectedResult: null,
      actualResult: null,
    });
  });

  it('works on sanitized HTML description text', () => {
    const html = `<p>Expected Result</p><p>Login succeeds</p><p>Actual Result</p><p>Blank screen</p>`;
    const sanitized = sanitizeClickUpDescription(html);

    expect(extractClickUpBugResults(sanitized)).toEqual({
      expectedResult: 'Login succeeds',
      actualResult: 'Blank screen',
    });
  });
});
