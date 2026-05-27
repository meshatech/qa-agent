import { describe, expect, it } from 'vitest';

import {
  overlapScore,
  pathTokens,
  tokenize,
  truncate,
} from '../src/domain/helpers/correlation-lexical.js';

describe('truncate', () => {
  it('returns the original string when shorter than max', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis when longer than max', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
    expect(truncate('hello world', 8).length).toBe(8);
  });

  it('returns empty string for empty input', () => {
    expect(truncate('', 10)).toBe('');
  });
});

describe('tokenize', () => {
  it('returns an empty set for empty input', () => {
    expect(tokenize('')).toEqual(new Set());
  });

  it('lowercases tokens and ignores punctuation', () => {
    expect(tokenize('Login, validate!')).toEqual(new Set(['login', 'validate']));
  });

  it('filters tokens shorter than 3 characters', () => {
    expect(tokenize('go to login page')).toEqual(new Set(['login', 'page']));
  });

  it('splits camelCase and PascalCase before tokenizing', () => {
    expect(tokenize('UserService')).toEqual(new Set(['user', 'service']));
    expect(tokenize('validate UserService behavior')).toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    );
    expect(tokenize('validate UserService behavior').has('user')).toBe(true);
    expect(tokenize('validate UserService behavior').has('service')).toBe(true);
    expect(tokenize('XMLHttpRequest')).toEqual(new Set(['xml', 'http', 'request']));
  });

  it('returns an empty set for punctuation-only input', () => {
    expect(tokenize('!!! ,,, ...')).toEqual(new Set());
  });

  it('tokenizes unicode and underscore or hyphenated words', () => {
    expect(tokenize('café_route-check')).toEqual(new Set(['caf', '_route-check']));
    expect(tokenize('user_profile-name')).toEqual(new Set(['user_profile-name']));
  });

  it('filters short tokens from long repeated strings', () => {
    const longText = `${'alpha '.repeat(50)}beta`;
    const tokens = tokenize(longText);

    expect(tokens.has('alpha')).toBe(true);
    expect(tokens.has('beta')).toBe(true);
    expect(tokens.size).toBe(2);
  });
});

describe('pathTokens', () => {
  it('extracts tokens from nested paths without file extension segments', () => {
    expect(pathTokens('src/routes/login.ts')).toEqual(new Set(['src', 'routes', 'login']));
  });

  it('splits camelCase segments in file paths', () => {
    const tokens = pathTokens('src/services/UserService.ts');
    expect(tokens.has('user')).toBe(true);
    expect(tokens.has('service')).toBe(true);
    expect(tokens.has('src')).toBe(true);
    expect(tokens.has('services')).toBe(true);
  });

  it('returns an empty set for empty path', () => {
    expect(pathTokens('')).toEqual(new Set());
  });

  it('ignores empty and dot segments in paths', () => {
    expect(pathTokens('//')).toEqual(new Set());
    expect(pathTokens('.')).toEqual(new Set());
    expect(pathTokens('..')).toEqual(new Set());
  });

  it('returns an empty set for extension-only paths', () => {
    expect(pathTokens('.ts')).toEqual(new Set());
  });
});

describe('overlapScore', () => {
  it('returns 0 for disjoint sets', () => {
    expect(overlapScore(new Set(['login', 'route']), new Set(['auth', 'token']))).toBe(0);
  });

  it('returns 0 when either set is empty', () => {
    expect(overlapScore(new Set(), new Set(['login']))).toBe(0);
    expect(overlapScore(new Set(['login']), new Set())).toBe(0);
  });

  it('returns partial overlap as matches divided by left set size', () => {
    expect(overlapScore(new Set(['login', 'route']), new Set(['login', 'auth']))).toBeCloseTo(0.5);
  });

  it('returns 1 when all left tokens appear in the right set', () => {
    expect(overlapScore(new Set(['login']), new Set(['login', 'auth']))).toBe(1);
  });

  it('matches camelCase criterion tokens against path segments', () => {
    const criterionTokens = tokenize('UserService validates users');
    const fileTokens = pathTokens('src/UserService.ts');

    expect(overlapScore(criterionTokens, fileTokens)).toBeGreaterThan(0);
  });

  it('returns 1 for identical token sets', () => {
    const tokens = new Set(['login', 'route']);
    expect(overlapScore(tokens, new Set(['login', 'route']))).toBe(1);
  });

  it('scores partial coverage when the left set is a subset of the right set', () => {
    expect(overlapScore(new Set(['login']), new Set(['login', 'route', 'auth']))).toBe(1);
    expect(overlapScore(new Set(['login', 'route']), new Set(['login', 'route', 'auth']))).toBe(1);
  });

  it('matches tokens containing slashes across sets', () => {
    expect(overlapScore(new Set(['login/route']), new Set(['login/route', 'auth']))).toBe(1);
  });
});
