import { describe, expect, it } from 'vitest';

import { buildMemorySearchQuery } from '../src/application/helpers/build-memory-search-query.js';
import type { DemandContext } from '../src/domain/schemas/demand-context.schema.js';
import type { ChangedFile } from '../src/domain/schemas/changed-file.schema.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';

const BASE_DEMAND: DemandContext = {
  taskId: 'PRJ-11396',
  title: 'Correlator memory search',
  description: 'Build query from demand and diff context.',
  acceptanceCriteria: [
    'Login route validates user credentials',
    'Invalid login shows error message',
  ],
  attachments: [],
  status: 'fazendo',
  assignees: [],
  priority: null,
  dueDate: null,
};

function createChangedFile(path: string): ChangedFile {
  return {
    path,
    status: 'modified',
    kind: 'route',
    positiveLines: [],
    negativeLines: [],
    contextLines: [],
  };
}

function createPrDiff(changedFiles: ChangedFile[]): PrDiffContext {
  return {
    schemaVersion: 'pr-diff-context.v1',
    pullRequest: {
      prNumber: 1,
      baseBranch: 'main',
      headBranch: 'feature/login',
      title: 'PRJ-11396 login',
      author: 'dev',
      clickUpTaskId: 'PRJ-11396',
    },
    changedFiles,
    affectedRoutes: ['/login', '/logout'],
    affectedSchemas: ['LoginSchema'],
  };
}

describe('buildMemorySearchQuery', () => {
  it('combines acceptance criteria, routes, schemas and top 5 changed file paths', () => {
    const changedFiles = [
      createChangedFile('src/routes/file-1.ts'),
      createChangedFile('src/routes/file-2.ts'),
      createChangedFile('src/routes/file-3.ts'),
      createChangedFile('src/routes/file-4.ts'),
      createChangedFile('src/routes/file-5.ts'),
      createChangedFile('src/routes/file-6.ts'),
    ];

    const query = buildMemorySearchQuery(BASE_DEMAND, createPrDiff(changedFiles));

    expect(query).toContain('Login route validates user credentials');
    expect(query).toContain('Invalid login shows error message');
    expect(query).toContain('/login');
    expect(query).toContain('/logout');
    expect(query).toContain('LoginSchema');
    expect(query).toContain('src/routes/file-1.ts');
    expect(query).toContain('src/routes/file-5.ts');
    expect(query).not.toContain('src/routes/file-6.ts');
  });

  it('trims leading and trailing whitespace from the joined query', () => {
    const query = buildMemorySearchQuery(
      {
        ...BASE_DEMAND,
        acceptanceCriteria: ['  Login route validates user credentials  '],
      },
      createPrDiff([createChangedFile('src/routes/login.ts')]),
    );

    expect(query).toBe(
      'Login route validates user credentials /login /logout LoginSchema src/routes/login.ts',
    );
  });
});
