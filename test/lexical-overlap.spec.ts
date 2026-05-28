import { describe, expect, it } from 'vitest';
import { tokenize, intersectionSize, computeOverlapScore } from '../src/domain/helpers/lexical-overlap.js';

describe('tokenize', () => {
  it('removes accents', () => {
    const result = tokenize('Usuário preenche email e senha');
    expect(result.has('usuario')).toBe(true);
    expect(result.has('preenche')).toBe(true);
    expect(result.has('email')).toBe(true);
    expect(result.has('senha')).toBe(true);
  });

  it('removes punctuation', () => {
    const result = tokenize('Login, register; and reset!');
    expect(result.has('login')).toBe(true);
    expect(result.has('register')).toBe(true);
    expect(result.has('reset')).toBe(true);
  });

  it('ignores short tokens', () => {
    const result = tokenize('a b cd');
    expect(result.has('a')).toBe(false);
    expect(result.has('cd')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('handles empty string', () => {
    const result = tokenize('');
    expect(result.size).toBe(0);
  });

  it('lowercases tokens', () => {
    const result = tokenize('LOGIN Form');
    expect(result.has('login')).toBe(true);
    expect(result.has('form')).toBe(true);
  });
});

describe('intersectionSize', () => {
  it('returns 0 for empty sets', () => {
    expect(intersectionSize(new Set(), new Set(['a']))).toBe(0);
    expect(intersectionSize(new Set(['a']), new Set())).toBe(0);
  });

  it('returns count for partial overlap', () => {
    const a = new Set(['login', 'form', 'email']);
    const b = new Set(['login', 'password', 'user']);
    expect(intersectionSize(a, b)).toBe(1);
  });

  it('returns count for total overlap', () => {
    const a = new Set(['login', 'form']);
    const b = new Set(['login', 'form']);
    expect(intersectionSize(a, b)).toBe(2);
  });
});

describe('computeOverlapScore', () => {
  it('returns 0 for distinct texts', () => {
    expect(computeOverlapScore('login do usuario', 'logout do sistema')).toBe(0);
  });

  it('returns 0 when one text has no valid tokens', () => {
    expect(computeOverlapScore('a b', 'login do usuario')).toBe(0);
  });

  it('returns partial score', () => {
    const score = computeOverlapScore('login do usuario com email', 'login do usuario com senha');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns 1 for equivalent texts', () => {
    expect(computeOverlapScore('login do usuario', 'login do usuario')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(computeOverlapScore('LOGIN do USUARIO', 'login do usuario')).toBe(1);
  });

  it('is accent-insensitive', () => {
    expect(computeOverlapScore('Usuário autentica email senha login', 'usuario autentica email senha login')).toBe(1);
  });
});
