import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { FilePreflightReportWriterAdapter } from '../src/infra/persistence/file-preflight-report-writer.adapter.js';
import { PREFLIGHT_CHECK_NAMES, PreflightReportSchema } from '../src/domain/schemas/preflight-report.schema.js';

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('FilePreflightReportWriterAdapter', () => {
  it('writes preflight-report.json and returns absolute path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-preflight-writer-'));
    tempDirs.push(dir);
    const adapter = new FilePreflightReportWriterAdapter();
    const report = PreflightReportSchema.parse({
      schemaVersion: 'preflight-report.v1',
      status: 'PASS',
      timestamp: new Date().toISOString(),
      tokensMasked: true,
      checkItems: PREFLIGHT_CHECK_NAMES.map((name) => ({ name, status: 'PASS', message: `${name} ok` })),
      checks: {
        clickupToken: { ok: true },
        clickupReadAccess: { ok: true },
        clickupTaskId: { ok: true },
        githubToken: { ok: true },
        prCommentPermission: { ok: true },
        prContext: { ok: true, missing: [] },
        branchHead: { ok: true, branchHead: 'feature/test', missing: [] },
        checkoutHistory: { ok: true, errors: [] },
        config: { ok: true, errors: [] },
      },
    });

    const path = await adapter.write(dir, report);
    const raw = await readFile(path, 'utf8');

    expect(path.endsWith('preflight-report.json')).toBe(true);
    expect(JSON.parse(raw).status).toBe('PASS');
  });
});
