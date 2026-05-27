import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { GitHubActionsPrContextReaderPort } from '../src/application/ports/github-actions-pr-context-reader.port.js';
import { PrDiffContextPersistenceService } from '../src/application/services/pr-diff-context-persistence.service.js';
import { SanitizerService } from '../src/application/services/sanitizer.service.js';
import { PrDiffContextSchema } from '../src/domain/schemas/pr-diff-context.schema.js';
import { FilePrDiffContextWriterAdapter } from '../src/infra/persistence/file-pr-diff-context-writer.adapter.js';

const VALID_READ_RESULT = {
  pullRequest: {
    prNumber: 42,
    baseBranch: 'main',
    headBranch: 'feature/test',
    title: 'PRJ-11552 — Fix login flow',
    author: 'octocat',
    clickUpTaskId: 'PRJ-11552',
  },
  rawDiff: 'diff --git a/src/routes/home.ts b/src/routes/home.ts\n',
  changedFiles: [
    {
      path: 'src/routes/home.ts',
      status: 'modified' as const,
      kind: 'route' as const,
      positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'new' }],
      negativeLines: [{ type: 'removed' as const, lineNumber: 1, content: 'old' }],
      contextLines: [],
    },
  ],
  affectedRoutes: ['/home'],
  affectedSchemas: [],
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('PrDiffContextPersistenceService', () => {
  it('persistFromGitHubActions writes validated pr-diff-context.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-persist-'));
    tempDirs.push(dir);
    const prContextReader: GitHubActionsPrContextReaderPort = {
      read: vi.fn(async () => VALID_READ_RESULT),
    };
    const service = new PrDiffContextPersistenceService(
      new FilePrDiffContextWriterAdapter(),
      prContextReader,
      new SanitizerService(),
    );

    const { path, context, tokensMasked } = await service.persistFromGitHubActions(dir);

    expect(path.endsWith('pr-diff-context.json')).toBe(true);
    expect(tokensMasked).toBe(true);
    expect(context.schemaVersion).toBe('pr-diff-context.v1');
    expect(context.changedFiles).toEqual(VALID_READ_RESULT.changedFiles);
    expect('rawDiff' in context).toBe(false);
    expect(PrDiffContextSchema.parse(JSON.parse(await readFile(path, 'utf8')))).toEqual(context);
  });

  it('does not write known secrets into pr-diff-context.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-persist-'));
    tempDirs.push(dir);
    const githubToken = 'ghp_secret_token_12345678';
    const clickupToken = 'pk_secret_token_87654321';
    const prContextReader: GitHubActionsPrContextReaderPort = {
      read: vi.fn(async () => ({
        ...VALID_READ_RESULT,
        changedFiles: [
          {
            ...VALID_READ_RESULT.changedFiles[0]!,
            positiveLines: [
              {
                type: 'added' as const,
                lineNumber: 1,
                content: `Authorization: Bearer ${githubToken}`,
              },
            ],
          },
        ],
      })),
    };
    const service = new PrDiffContextPersistenceService(
      new FilePrDiffContextWriterAdapter(),
      prContextReader,
      new SanitizerService(),
    );

    const { path, context } = await service.persistFromGitHubActions(dir, {
      knownSecrets: [githubToken, clickupToken],
    });
    const raw = await readFile(path, 'utf8');

    expect(raw).not.toContain(githubToken);
    expect(raw).not.toContain(clickupToken);
    expect(raw).toContain('***REDACTED***');
    expect(context.changedFiles[0]?.positiveLines[0]?.content).toContain('***REDACTED***');
  });

  it('warns on pre-sanitize leak and sets tokensMasked true when sanitize removes secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-persist-'));
    tempDirs.push(dir);
    const leakedSecret = 'ghp_redactible_secret_value_12345678';
    const prContextReader: GitHubActionsPrContextReaderPort = {
      read: vi.fn(async () => ({
        ...VALID_READ_RESULT,
        changedFiles: [
          {
            ...VALID_READ_RESULT.changedFiles[0]!,
            positiveLines: [
              {
                type: 'added' as const,
                lineNumber: 1,
                content: `Authorization: Bearer ${leakedSecret}`,
              },
            ],
          },
        ],
      })),
    };
    const sanitizer = new SanitizerService();
    const containsLeakedSecrets = vi.spyOn(sanitizer, 'containsLeakedSecrets');
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new PrDiffContextPersistenceService(
      new FilePrDiffContextWriterAdapter(),
      prContextReader,
      sanitizer,
    );

    const { tokensMasked } = await service.persistFromGitHubActions(dir, {
      knownSecrets: [leakedSecret],
    });

    expect(tokensMasked).toBe(true);
    expect(containsLeakedSecrets).toHaveBeenCalledTimes(2);
    expect(containsLeakedSecrets.mock.calls[0]?.[0]).toContain(leakedSecret);
    expect(warnSpy).toHaveBeenCalledWith(
      'Potential secret material detected in PR diff context before sanitization',
    );
    warnSpy.mockRestore();
  });

  it('sets tokensMasked false when sanitized output still contains secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-persist-'));
    tempDirs.push(dir);
    const leakedSecret = 'residual_leak_secret_value';
    const prContextReader: GitHubActionsPrContextReaderPort = {
      read: vi.fn(async () => ({
        ...VALID_READ_RESULT,
        changedFiles: [
          {
            ...VALID_READ_RESULT.changedFiles[0]!,
            positiveLines: [
              {
                type: 'added' as const,
                lineNumber: 1,
                content: leakedSecret,
              },
            ],
          },
        ],
      })),
    };
    const passthroughSanitizer = {
      sanitizeForOutput: <T>(input: T) => input,
      containsLeakedSecrets: (serialized: string, secrets: string[]) =>
        new SanitizerService().containsLeakedSecrets(serialized, secrets),
    } as unknown as SanitizerService;
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new PrDiffContextPersistenceService(
      new FilePrDiffContextWriterAdapter(),
      prContextReader,
      passthroughSanitizer,
    );

    const { tokensMasked } = await service.persistFromGitHubActions(dir, {
      knownSecrets: [leakedSecret],
    });

    expect(tokensMasked).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'Potential secret material detected in PR diff context before sanitization',
    );
    warnSpy.mockRestore();
  });

  it('redacts secrets from env without explicit knownSecrets option', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-persist-'));
    tempDirs.push(dir);
    const envSecret = 'custom_pipeline_secret_xyz';
    const prContextReader: GitHubActionsPrContextReaderPort = {
      read: vi.fn(async () => ({
        ...VALID_READ_RESULT,
        changedFiles: [
          {
            ...VALID_READ_RESULT.changedFiles[0]!,
            positiveLines: [
              {
                type: 'added' as const,
                lineNumber: 1,
                content: `token=${envSecret}`,
              },
            ],
          },
        ],
      })),
    };
    const service = new PrDiffContextPersistenceService(
      new FilePrDiffContextWriterAdapter(),
      prContextReader,
      new SanitizerService(),
    );

    const { path } = await service.persistFromGitHubActions(dir, {
      env: { GITHUB_TOKEN: envSecret },
    });
    const raw = await readFile(path, 'utf8');

    expect(raw).not.toContain(envSecret);
    expect(raw).toContain('***REDACTED***');
  });

  it('persists empty diff when reader returns no changed files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-persist-'));
    tempDirs.push(dir);
    const prContextReader: GitHubActionsPrContextReaderPort = {
      read: vi.fn(async () => ({
        ...VALID_READ_RESULT,
        rawDiff: '',
        changedFiles: [],
        affectedRoutes: [],
        affectedSchemas: [],
      })),
    };
    const service = new PrDiffContextPersistenceService(
      new FilePrDiffContextWriterAdapter(),
      prContextReader,
      new SanitizerService(),
    );

    const { context } = await service.persistFromGitHubActions(dir);

    expect(context.changedFiles).toEqual([]);
    expect(context.affectedRoutes).toEqual([]);
    expect(context.affectedSchemas).toEqual([]);
  });
});
