import { describe, expect, it, vi } from 'vitest';

import { EvidenceRecordTool } from '../src/application/tools/built-in/record_evidence.tool.js';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const config = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D1', title: 'Smoke', description: 'Smoke' },
});

describe('qa.evidence.record', () => {
  it('delegates evidence recording to EvidenceService and returns artifact paths', async () => {
    const bug = {
      bugId: 'bug-1',
      stepId: 'S001',
      scenarioId: 'scenario-001',
      classification: { isBug: true, severity: 'HIGH', category: 'APP_FAULT', reason: 'failed' },
      path: 'bugs/bug-1',
      capturedAt: '2026-05-22T00:00:00.000Z',
    };
    const evidence = { record: vi.fn(async () => bug) };
    const registry = new QaToolRegistry([EvidenceRecordTool]);

    await expect(registry.execute('qa.evidence.record', {
      runDir: '.agent-qa/runs/run-1',
      runId: 'run-1',
      scenarioId: 'scenario-001',
      reason: 'Scenario failed',
      status: 'FAILED',
      config,
      includeScreenshot: true,
      includeVideo: true,
      includeTrace: true,
      includeDomSnapshot: true,
      includeConsoleLog: true,
      includeNetworkLog: true,
      outputConfig: { artifactsDir: '.agent-qa/runs/run-1' },
      evidence: {
        bugId: 'bug-1',
        step: {
          stepId: 'S001',
          action: { type: 'waitForStable', reason: 'wait' },
          resolvedAction: { type: 'waitForStable', reason: 'wait' },
          boundExpected: { type: 'text_visible', text: 'Done' },
        },
        classification: { isBug: true, severity: 'HIGH', category: 'APP_FAULT', reason: 'failed' },
      },
    }, {
      metadata: { evidence },
    })).resolves.toMatchObject({
      ok: true,
      issues: [],
      result: {
        evidenceBundle: {
          bug,
          requested: {
            runId: 'run-1',
            scenarioId: 'scenario-001',
            reason: 'Scenario failed',
            status: 'FAILED',
            includeScreenshot: true,
            includeVideo: true,
            includeTrace: true,
            includeDomSnapshot: true,
            includeConsoleLog: true,
            includeNetworkLog: true,
          },
        },
        relativePaths: expect.arrayContaining([
          'bugs/bug-1/bug.json',
          'bugs/bug-1/bug-report.md',
          'bugs/bug-1/observation.json',
          'bugs/bug-1/screenshot.png',
          'bugs/bug-1/dom-snapshot.html',
          'bugs/bug-1/console.log',
          'bugs/bug-1/network.json',
          'bugs/bug-1/trace.zip',
          'bugs/bug-1/video.webm',
        ]),
        artifactPaths: expect.arrayContaining([
          '.agent-qa/runs/run-1/bugs/bug-1/screenshot.png',
          '.agent-qa/runs/run-1/bugs/bug-1/trace.zip',
          '.agent-qa/runs/run-1/bugs/bug-1/video.webm',
        ]),
      },
    });
    expect(evidence.record).toHaveBeenCalledWith('.agent-qa/runs/run-1', expect.objectContaining({
      bugId: 'bug-1',
      runId: 'run-1',
      scenarioId: 'scenario-001',
      config,
      rawMessage: 'Scenario failed',
      reason: 'Scenario failed',
      status: 'FAILED',
      outputConfig: { artifactsDir: '.agent-qa/runs/run-1' },
    }));
  });

  it('uses context runDir/config and masks sensitive text before delegating', async () => {
    const evidence = {
      record: vi.fn(async () => ({
        bugId: 'bug-2',
        stepId: 'S002',
        classification: { isBug: true, severity: 'MEDIUM', category: 'APP_FAULT', reason: 'failed' },
        path: 'bugs/bug-2',
        capturedAt: '2026-05-22T00:00:00.000Z',
      })),
    };
    const registry = new QaToolRegistry([EvidenceRecordTool]);

    const result = await registry.execute('qa.evidence.record', {
      runId: 'run-2',
      scenarioId: 'scenario-002',
      reason: 'Failure token=abc123 password=secret Bearer eyJhbGciOiJIUzI1NiJ9',
      status: 'BLOCKED',
      includeScreenshot: false,
      includeConsoleLog: false,
      includeNetworkLog: false,
      evidence: { bugId: 'bug-2' },
    }, {
      runDir: '.agent-qa/runs/run-2',
      config,
      metadata: { evidence },
    });

    expect(evidence.record).toHaveBeenCalledWith('.agent-qa/runs/run-2', expect.objectContaining({
      rawMessage: 'Failure token=*** password=*** Bearer ***',
      reason: 'Failure token=*** password=*** Bearer ***',
      config,
    }));
    expect(JSON.stringify(result)).not.toContain('abc123');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toMatchObject({
      result: {
        evidenceBundle: {
          requested: {
            reason: 'Failure token=*** password=*** Bearer ***',
          },
        },
        relativePaths: expect.not.arrayContaining([
          'bugs/bug-2/screenshot.png',
          'bugs/bug-2/console.log',
          'bugs/bug-2/network.json',
        ]),
      },
    });
  });

  it('does not expose or call direct Playwright/browser actions', async () => {
    const evidence = {
      record: vi.fn(async () => ({
        bugId: 'bug-3',
        stepId: 'S003',
        classification: { isBug: false, severity: 'LOW', category: 'APP_FAULT', reason: 'warning' },
        path: 'bugs/bug-3',
        capturedAt: '2026-05-22T00:00:00.000Z',
      })),
    };
    const playwrightHarness = {
      click: vi.fn(),
      fill: vi.fn(),
      press: vi.fn(),
      navigate: vi.fn(),
      page: {},
    };
    const registry = new QaToolRegistry([EvidenceRecordTool]);
    const result = await registry.execute('qa.evidence.record', {
      runDir: '.agent-qa/runs/run-3',
      reason: 'warning captured',
      status: 'PASSED_WITH_WARNINGS',
      evidence: { bugId: 'bug-3' },
    }, {
      metadata: { evidence, playwrightHarness },
    });

    expect(playwrightHarness.click).not.toHaveBeenCalled();
    expect(playwrightHarness.fill).not.toHaveBeenCalled();
    expect(playwrightHarness.press).not.toHaveBeenCalled();
    expect(playwrightHarness.navigate).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('page');
  });
});
