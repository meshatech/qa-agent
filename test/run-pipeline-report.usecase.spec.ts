import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RunPipelineReportUseCase } from '../src/application/use-cases/run-pipeline-report.usecase.js';
import { PipelineReportRenderer } from '../src/application/services/pipeline-report-renderer.service.js';

const MOCK_CONFIG = {
  baseUrl: 'http://127.0.0.1:4173/',
  appDomains: ['127.0.0.1'],
  demand: { id: 'PRJ-TEST', title: 'Test Demand', description: 'Test desc' },
  auth: { kind: 'none' as const },
  llm: { provider: 'fake' as const },
};

async function setupTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-report-'));
  await writeFile(join(dir, 'agent-qa.config.json'), JSON.stringify(MOCK_CONFIG), 'utf8');
  await writeFile(join(dir, 'execution-plan.json'), JSON.stringify({
    schemaVersion: 'execution-plan.v1',
    planId: 'plan_test',
    version: 1,
    goal: 'Test',
    mode: 'HYBRID_GUARDED',
    runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
    steps: [{ id: 'S001', description: 'Step 1' }],
    assertions: [],
    metadata: { planSource: 'factory', fallbackReason: undefined },
  }), 'utf8');
  await writeFile(join(dir, 'execution-result.json'), JSON.stringify({
    ok: true,
    steps: [{ stepId: 'S001', validation: { ok: true } }],
    warnings: [{ stepId: 'S001', message: 'Minor quiescence delay' }],
    locatorTelemetry: [
      { stepId: 'S001', type: 'deterministic_resolution', timestamp: '2024-01-01T00:00:00Z' },
      { stepId: 'S002', type: 'semantic_fallback', timestamp: '2024-01-01T00:00:00Z' },
    ],
  }), 'utf8');
  await writeFile(join(dir, 'required-scenarios.json'), JSON.stringify({ scenarios: [{ id: 'RS-001' }] }), 'utf8');
  await writeFile(join(dir, 'selected-scenarios.json'), JSON.stringify({ scenarios: [{ id: 'SS-001' }] }), 'utf8');
  await writeFile(join(dir, 'pr-diff-context.json'), JSON.stringify({ changedFiles: [{ path: 'src/test.ts' }] }), 'utf8');
  await writeFile(join(dir, 'preflight-report.json'), JSON.stringify({ status: 'PASSED' }), 'utf8');
  return dir;
}

describe('RunPipelineReportUseCase', () => {
  it('generates pipeline-report.md from artifacts', async () => {
    const dir = await setupTempDir();

    const useCase = new RunPipelineReportUseCase(
      new PipelineReportRenderer(),
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.reportPath).toBeDefined();
    expect(result.pipelineStatus).toBe('COMPLETED');
    expect(result.sectionsGenerated).toContain('Header');
    expect(result.sectionsGenerated).toContain('Pipeline Steps');
    expect(result.sectionsGenerated).toContain('Execution Summary');
    expect(result.sectionsGenerated).toContain('Locator Telemetry');
    expect(result.sectionsGenerated).toContain('Warnings');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(result.reportPath, 'utf8');
    expect(content).toContain('# QA Agent — Pipeline Report');
    expect(content).toContain('PRJ-TEST');
    expect(content).toContain('Test Demand');
    expect(content).toContain('Deterministic resolutions');
    expect(content).toContain('Semantic fallbacks');

    await rm(dir, { recursive: true, force: true });
  });

  it('marks PARTIAL when execution result is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-report-'));
    await writeFile(join(dir, 'agent-qa.config.json'), JSON.stringify(MOCK_CONFIG), 'utf8');
    await writeFile(join(dir, 'execution-plan.json'), JSON.stringify({
      schemaVersion: 'execution-plan.v1', planId: 'plan_test', version: 1, goal: 'Test', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      steps: [], assertions: [],
    }), 'utf8');

    const useCase = new RunPipelineReportUseCase(
      new PipelineReportRenderer(),
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.pipelineStatus).toBe('PARTIAL');

    await rm(dir, { recursive: true, force: true });
  });
});
