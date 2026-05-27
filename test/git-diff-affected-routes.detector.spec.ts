import { describe, expect, it } from 'vitest';

import type { ChangedFile } from '../src/domain/schemas/changed-file.schema.js';
import {
  detectAffectedRoutes,
  extractRouteFromChangedFilePath,
} from '../src/infra/github/git-diff-affected-routes.detector.js';

function createRouteFile(path: string): ChangedFile {
  return {
    path,
    status: 'modified',
    kind: 'route',
    positiveLines: [],
    negativeLines: [],
    contextLines: [],
  };
}

function createChangedFile(path: string, kind: ChangedFile['kind']): ChangedFile {
  return {
    path,
    status: 'modified',
    kind,
    positiveLines: [],
    negativeLines: [],
    contextLines: [],
  };
}

describe('extractRouteFromChangedFilePath', () => {
  it.each([
    ['src/routes/home.ts', '/home'],
    ['src/pages/login.tsx', '/login'],
    ['src/routes/admin/users.ts', '/admin/users'],
    ['src/routes/index.ts', '/'],
    ['src/routes/admin/index.ts', '/admin'],
    ['app/routes/dashboard.ts', '/dashboard'],
  ] as const)('maps %s to %s', (path, route) => {
    expect(extractRouteFromChangedFilePath(path)).toBe(route);
  });

  it('returns undefined for paths without routes or pages segment', () => {
    expect(extractRouteFromChangedFilePath('src/application/service.ts')).toBeUndefined();
  });
});

describe('detectAffectedRoutes', () => {
  it('returns only routes from changed files classified as route', () => {
    expect(
      detectAffectedRoutes([
        createRouteFile('src/routes/home.ts'),
        createChangedFile('src/domain/schemas/foo.schema.ts', 'schema'),
        createChangedFile('src/application/service.ts', 'other'),
      ]),
    ).toEqual(['/home']);
  });

  it('deduplicates and sorts affected routes deterministically', () => {
    expect(
      detectAffectedRoutes([
        createRouteFile('src/routes/zeta.ts'),
        createRouteFile('src/pages/alpha.tsx'),
        createRouteFile('src/routes/zeta/index.ts'),
      ]),
    ).toEqual(['/alpha', '/zeta']);
  });

  it('returns empty array when no route files changed', () => {
    expect(detectAffectedRoutes([])).toEqual([]);
    expect(detectAffectedRoutes([createChangedFile('README.md', 'docs')])).toEqual([]);
  });
});
