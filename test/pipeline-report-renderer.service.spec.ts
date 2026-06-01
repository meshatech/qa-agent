import { describe, expect, it } from 'vitest';

import { PipelineReportRenderer } from '../src/application/services/pipeline-report-renderer.service.js';

describe('PipelineReportRenderer', () => {
  const renderer = new PipelineReportRenderer();

  it('renders minimal report with only demand info', () => {
    const report = renderer.render({
      demandId: 'DEM-001',
      demandTitle: 'Test demand',
    });
    expect(report).toContain('# QA Agent — Pipeline Report');
    expect(report).toContain('**Demand:** DEM-001 — Test demand');
    expect(report).toContain('**Pipeline Status:** COMPLETED');
  });

  it('renders FAILED status when executionOk is false', () => {
    const report = renderer.render({
      demandId: 'DEM-002',
      demandTitle: 'Failed demand',
      executionOk: false,
    });
    expect(report).toContain('**Pipeline Status:** FAILED');
  });

  it('renders preflight status when provided', () => {
    const report = renderer.render({
      demandId: 'DEM-003',
      preflightStatus: 'OK',
    });
    expect(report).toContain('**Preflight:** OK');
  });

  it('renders pipeline steps table', () => {
    const report = renderer.render({
      changedFilesCount: 5,
      requiredScenariosCount: 3,
      selectedScenariosCount: 2,
      executionPlanSteps: 10,
      stepsExecuted: 8,
      executionOk: true,
    });
    expect(report).toContain('## Pipeline Steps');
    expect(report).toContain('| PR Diff Context | OK | 5 changed files |');
    expect(report).toContain('| Correlation | OK | 3 required scenarios |');
    expect(report).toContain('| Scenario Selection | OK | 2 selected scenarios |');
    expect(report).toContain('| Plan Generation | OK | 10 plan steps |');
    expect(report).toContain('| Execution | PASSED | 8 steps executed |');
  });

  it('renders FAILED execution status', () => {
    const report = renderer.render({
      stepsExecuted: 5,
      executionOk: false,
    });
    expect(report).toContain('| Execution | FAILED | 5 steps executed |');
  });

  it('renders execution summary', () => {
    const report = renderer.render({
      stepsExecuted: 10,
      stepsPassed: 8,
      stepsFailed: 2,
      warningsCount: 1,
    });
    expect(report).toContain('## Execution Summary');
    expect(report).toContain('- Steps executed: 10');
    expect(report).toContain('- Steps passed: 8');
    expect(report).toContain('- Steps failed: 2');
    expect(report).toContain('- Warnings: 1');
  });

  it('renders execution summary with defaults for undefined values', () => {
    const report = renderer.render({
      stepsExecuted: 3,
    });
    expect(report).toContain('- Steps passed: 0');
    expect(report).toContain('- Steps failed: 0');
    expect(report).toContain('- Warnings: 0');
  });

  it('skips execution summary when stepsExecuted is undefined', () => {
    const report = renderer.render({
      demandId: 'DEM-004',
    });
    expect(report).not.toContain('## Execution Summary');
  });

  it('renders locator telemetry', () => {
    const report = renderer.render({
      locatorTelemetrySummary: {
        deterministicResolutions: 10,
        semanticFallbacks: 3,
        llmDecides: 1,
        replans: 2,
        targetsNotFound: 0,
      },
    });
    expect(report).toContain('## Locator Telemetry');
    expect(report).toContain('| Deterministic resolutions | 10 |');
    expect(report).toContain('| Semantic fallbacks | 3 |');
    expect(report).toContain('| LLM decides | 1 |');
    expect(report).toContain('| Replans | 2 |');
    expect(report).toContain('| Targets not found | 0 |');
  });

  it('skips locator telemetry when summary is absent', () => {
    const report = renderer.render({
      demandId: 'DEM-005',
    });
    expect(report).not.toContain('## Locator Telemetry');
  });

  it('renders warnings', () => {
    const report = renderer.render({
      warnings: [
        { stepId: 'step-001', message: 'Console error detected' },
        { stepId: 'step-002', message: 'Network timeout' },
      ],
    });
    expect(report).toContain('## Warnings');
    expect(report).toContain('- **step-001:** Console error detected');
    expect(report).toContain('- **step-002:** Network timeout');
  });

  it('skips warnings section when empty', () => {
    const report = renderer.render({
      warnings: [],
    });
    expect(report).not.toContain('## Warnings');
  });

  it('renders artifacts', () => {
    const report = renderer.render({
      executionPlanPath: '/tmp/plan.json',
      executionResultPath: '/tmp/result.json',
      fallbackReason: 'Plan generation failed, using default plan',
    });
    expect(report).toContain('## Artifacts');
    expect(report).toContain('- Execution plan: `/tmp/plan.json`');
    expect(report).toContain('- Execution result: `/tmp/result.json`');
    expect(report).toContain('- Fallback reason: Plan generation failed, using default plan');
  });

  it('renders artifacts section even with no paths', () => {
    const report = renderer.render({
      demandId: 'DEM-006',
    });
    expect(report).toContain('## Artifacts');
    expect(report).not.toContain('- Execution plan:');
    expect(report).not.toContain('- Execution result:');
    expect(report).not.toContain('- Fallback reason:');
  });

  it('renders complete report with all sections', () => {
    const report = renderer.render({
      demandId: 'DEM-007',
      demandTitle: 'Full test',
      preflightStatus: 'OK',
      changedFilesCount: 4,
      requiredScenariosCount: 3,
      selectedScenariosCount: 3,
      executionPlanSteps: 12,
      executionOk: true,
      stepsExecuted: 12,
      stepsPassed: 12,
      stepsFailed: 0,
      warningsCount: 0,
      locatorTelemetrySummary: {
        deterministicResolutions: 12,
        semanticFallbacks: 0,
        llmDecides: 0,
        replans: 0,
        targetsNotFound: 0,
      },
      warnings: [],
      fallbackReason: undefined,
      executionPlanPath: '/tmp/plan.json',
      executionResultPath: '/tmp/result.json',
    });
    expect(report).toContain('# QA Agent — Pipeline Report');
    expect(report).toContain('## Pipeline Steps');
    expect(report).toContain('## Execution Summary');
    expect(report).toContain('## Locator Telemetry');
    expect(report).not.toContain('## Warnings');
    expect(report).toContain('## Artifacts');
  });
});
