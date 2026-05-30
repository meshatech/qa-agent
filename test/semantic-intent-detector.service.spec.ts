import { describe, expect, it } from 'vitest';

import { SemanticIntentDetectorService } from '../src/application/services/semantic-intent-detector.service.js';
import type { QaTask } from '../src/domain/models/run.model.js';
import type { ExpectedOutcome } from '../src/domain/schemas/expected-outcome.schema.js';

function task(partial: Partial<QaTask> & { title: string }): QaTask {
  return { id: 'T1', expected: '', status: 'PENDING', ...partial };
}

function withOutcome(kind: ExpectedOutcome['kind'], title = 'qualquer texto'): QaTask {
  return task({ title, expected: title, expectedOutcome: { kind, description: 'x' } });
}

describe('SemanticIntentDetectorService', () => {
  const detector = new SemanticIntentDetectorService();

  describe('contract-first (typed, word-agnostic)', () => {
    it('classifies by ExpectedOutcome kind, ignoring task text', () => {
      // Text says "navegar" but the contract says DEAUTHENTICATION -> logout.
      const t = task({ title: 'navegar para pagina', expected: 'ok', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'x' } });
      expect(detector.classify(t)).toBe('DEAUTHENTICATION');
      expect(detector.isLogout(t)).toBe(true);
    });

    it('maps every outcome kind', () => {
      expect(detector.classify(withOutcome('AUTHENTICATION'))).toBe('AUTHENTICATION');
      expect(detector.classify(withOutcome('DEAUTHENTICATION'))).toBe('DEAUTHENTICATION');
      expect(detector.classify(withOutcome('NAVIGATION'))).toBe('NAVIGATION');
      expect(detector.classify(withOutcome('APPEARANCE_CHANGE'))).toBe('APPEARANCE_CHANGE');
      expect(detector.classify(withOutcome('DISCLOSURE'))).toBe('DISCLOSURE');
      expect(detector.classify(withOutcome('CONTENT_PRESENCE'))).toBe('GENERIC');
      expect(detector.classify(withOutcome('DATA_ENTRY'))).toBe('GENERIC');
      expect(detector.classify(withOutcome('NO_REGRESSION'))).toBe('GENERIC');
    });

    it('works for non-pt/en wording when a contract is present', () => {
      const t = task({ title: 'cerrar sesión del usuario', expected: 'anónimo', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'es' } });
      expect(detector.isLogout(t)).toBe(true);
    });

    it('helpers reflect classification', () => {
      expect(detector.isTheme(withOutcome('APPEARANCE_CHANGE'))).toBe(true);
      expect(detector.isMenu(withOutcome('DISCLOSURE'))).toBe(true);
      expect(detector.isAuthentication(withOutcome('AUTHENTICATION'))).toBe(true);
      expect(detector.isNavigation(withOutcome('NAVIGATION'))).toBe(true);
    });
  });

  describe('no contract', () => {
    it('returns GENERIC when no contract is present', () => {
      expect(detector.classify(task({ title: 'Preencher formulario', expected: 'salvo' }))).toBe('GENERIC');
      expect(detector.isLogout(task({ title: 'Sair da conta', expected: 'logout' }))).toBe(false);
      expect(detector.isTheme(task({ title: 'Alterar tema escuro', expected: 'tema mudou' }))).toBe(false);
    });
  });
});
