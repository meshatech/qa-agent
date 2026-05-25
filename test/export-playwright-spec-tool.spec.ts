import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpecExportTool } from '../src/application/tools/built-in/export_playwright_spec.tool.js';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';

let tempDirs: string[] = [];

describe('qa.spec.export', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('exports an experimental Playwright spec from execution-log and returns the generated path', async () => {
    const runDir = await tempRunDir();
    const executionLogPath = join(runDir, 'execution-log.json');
    const outputPath = join(runDir, 'generated-test.spec.ts');
    await writeFile(executionLogPath, JSON.stringify({
      version: 'log.v1',
      runId: 'run-1',
      steps: [{ stepId: 'S001', resolvedAction: { type: 'waitForStable', reason: 'wait' }, boundExpected: { type: 'text_visible', text: 'Dashboard' } }],
      bugs: [],
    }), 'utf8');
    const specExporter = {
      export: vi.fn(() => [
        "import { test } from '@playwright/test';",
        "test('agent-qa generated flow (experimental)', async ({ page }) => {",
        "  await page.getByText('Dashboard').click();",
        '});',
        '',
      ].join('\n')),
    };
    const registry = new QaToolRegistry([SpecExportTool]);

    const result = await registry.execute('qa.spec.export', {
      executionLogPath,
      runId: 'run-1',
      scenarioId: 'scenario-001',
      sanitizeSensitiveData: true,
      outputPath,
    }, {
      runDir,
      metadata: { specExporter },
    });

    await expect(readFile(outputPath, 'utf8')).resolves.toContain('experimental');
    expect(specExporter.export).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PASSED',
      runDir,
      steps: expect.any(Array),
      bugs: [],
    }));
    expect(result).toEqual({
      ok: true,
      issues: [],
      result: {
        generatedSpecPath: outputPath,
        warnings: ['Experimental export: generated spec is an artifact only and is not used by Agent QA runtime.'],
      },
    });
  });

  it('sanitizes sensitive data before writing the generated spec', async () => {
    const runDir = await tempRunDir();
    const outputPath = join(runDir, 'generated-test.spec.ts');
    const specExporter = {
      export: vi.fn(() => [
        "await page.getByLabel('Password').fill('secret-value');",
        'const token = "abc123";',
        'await page.setExtraHTTPHeaders({ Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9" });',
      ].join('\n')),
    };
    const registry = new QaToolRegistry([SpecExportTool]);

    await registry.execute('qa.spec.export', {
      result: { status: 'PASSED', runDir, steps: [] },
      sanitizeSensitiveData: true,
      outputPath,
    }, {
      metadata: { specExporter },
    });

    const generated = await readFile(outputPath, 'utf8');
    expect(generated).not.toContain('abc123');
    expect(generated).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(generated).toContain('Bearer ***');
  });

  it('returns a warning when execution-log cannot be read and does not call browser/runtime actions', async () => {
    const runDir = await tempRunDir();
    const specExporter = { export: vi.fn() };
    const playwrightHarness = { click: vi.fn(), fill: vi.fn(), press: vi.fn(), navigate: vi.fn(), page: {} };
    const registry = new QaToolRegistry([SpecExportTool]);
    const result = await registry.execute('qa.spec.export', {
      executionLogPath: join(runDir, 'missing-execution-log.json'),
      outputPath: join(runDir, 'generated-test.spec.ts'),
    }, {
      metadata: { specExporter, playwrightHarness },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        generatedSpecPath: undefined,
        warnings: expect.arrayContaining([
          expect.stringContaining('executionLogPath could not be read'),
        ]),
      },
    });
    expect(specExporter.export).not.toHaveBeenCalled();
    expect(playwrightHarness.click).not.toHaveBeenCalled();
    expect(playwrightHarness.fill).not.toHaveBeenCalled();
    expect(playwrightHarness.press).not.toHaveBeenCalled();
    expect(playwrightHarness.navigate).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('page');
  });
});

async function tempRunDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-spec-export-'));
  tempDirs.push(dir);
  return dir;
}
