import { describe, expect, it } from 'vitest';
import { ReportRenderer } from '../src/infra/persistence/report-renderer.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { QaBug, QaRunResult, QaStep } from '../src/domain/models/run.model.js';

const config = RunConfigSchema.parse({
  baseUrl: 'http://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D', title: 'Cadastrar produto', description: 'Cenário smoke' },
});

const bug: QaBug = {
  bugId: 'BUG-001',
  stepId: 'S0001',
  scenarioId: 'scenario-001',
  taskId: 'T001',
  classification: { isBug: true, severity: 'CRITICAL', category: 'APP_FAULT', reason: 'POST /api/x 500' },
  path: 'bugs/BUG-001',
  url: '/produtos/novo',
  expected: 'mensagem de sucesso',
  actual: '500 Internal Server Error',
  signalType: 'APP_NETWORK_5XX',
  capturedAt: '2026-05-19T17:31:22.000Z',
};

const step: QaStep = {
  stepId: 'S0001',
  scenarioId: 'scenario-001',
  taskId: 'T001',
  action: { type: 'click', targetElementId: 'el_001', reason: 'click salvar' },
  resolvedAction: { type: 'click', targetElementId: 'el_001', reason: 'click salvar' },
  boundExpected: { type: 'text_visible', text: 'Produto cadastrado' },
};

describe('ReportRenderer', () => {
  it('renders complete bug-report.md following doc 16 template', () => {
    const md = new ReportRenderer().renderBugReport({
      bug,
      step,
      config,
      attempts: [{ actionType: 'click', result: 'FAILED', reason: 'timeout', ts: '2026-05-19T17:31:22Z' }],
      consoleLogs: 'POST /api/x 500',
      runId: '2026-05-19_17-30-22__abcd',
    });
    expect(md).toContain('# BUG-001');
    expect(md).toContain('## Severidade\nCRITICAL');
    expect(md).toContain('## Categoria\nAPP_FAULT');
    expect(md).toContain('## Cenário\nscenario-001');
    expect(md).toContain('## Task\nT001');
    expect(md).toContain('## URL\n/produtos/novo');
    expect(md).toContain('## Resultado esperado\nmensagem de sucesso');
    expect(md).toContain('## Resultado obtido\n500 Internal Server Error');
    expect(md).toContain('## Sinal\nAPP_NETWORK_5XX');
    expect(md).toContain('- Screenshot: ./screenshot.png');
    expect(md).toContain('- Vídeo: ./video.webm');
    expect(md).toContain('- Trace: ./trace.zip');
    expect(md).toContain('| Ação | Resultado | Motivo | Timestamp |');
    expect(md).toContain('## Possível causa');
    expect(md).toContain('runId: 2026-05-19_17-30-22__abcd');
  });

  it('renders execution-report.md with metrics table and scenarios', () => {
    const result: QaRunResult = {
      status: 'BLOCKED',
      runDir: '/tmp/run',
      startedAt: '2026-05-19T17:00:00Z',
      finishedAt: '2026-05-19T17:05:00Z',
      steps: [step],
      bugs: [bug],
      scenarios: [{
        id: 'scenario-001',
        title: 'Cadastrar produto',
        status: 'BLOCKED',
        tasks: [
          { id: 'T001', title: 'Navegar', expected: 'tela', status: 'PASSED' },
          { id: 'T002', title: 'Salvar', expected: 'sucesso', status: 'BLOCKED', dependsOn: ['T001'] },
          { id: 'T003', title: 'Verificar', expected: 'visível', status: 'SKIPPED', dependsOn: ['T002'] },
        ],
      }],
      metrics: {
        totalScenarios: 1,
        passedScenarios: 0,
        failedScenarios: 0,
        blockedScenarios: 1,
        totalTasks: 3,
        passedTasks: 1,
        failedTasks: 0,
        skippedTasks: 1,
        totalSteps: 1,
        passedSteps: 0,
        failedSteps: 1,
        totalBugs: 1,
        bugsBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 1 },
        totalDurationMs: 300000,
      },
    };
    const md = new ReportRenderer().renderExecutionReport(result, config, 'run-id');
    expect(md).toContain('# Execution Report — Run run-id');
    expect(md).toContain('Demanda: Cadastrar produto');
    expect(md).toContain('Status: BLOCKED');
    expect(md).toContain('| Cenários | 1 |');
    expect(md).toContain('| Bugs CRITICAL | 1 |');
    expect(md).toContain('### Cadastrar produto — BLOCKED');
    expect(md).toContain('- T002 BLOCKED: Salvar');
    expect(md).toContain('- T003 SKIPPED: Verificar');
    expect(md).toContain('depende: T001');
    expect(md).toContain('- [BUG-001](bugs/BUG-001/bug-report.md)');
  });
});
