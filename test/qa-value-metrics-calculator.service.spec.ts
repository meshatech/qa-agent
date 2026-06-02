import { describe, expect, it } from 'vitest';
import { QaValueMetricsCalculatorService } from '../src/application/services/qa-value-metrics-calculator.service.js';
import type { QaRunResult } from '../src/domain/models/run.model.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

const calculator = new QaValueMetricsCalculatorService();

function makeConfig(minutesPerScenario = 10): RunConfig {
  return {
    baseUrl: 'http://localhost:3000',
    appDomains: ['localhost'],
    demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['AC1', 'AC2'] },
    auth: { kind: 'none' },
    llm: { provider: 'fake', model: 'test', apiKeyEnv: 'TEST_KEY', maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1', temperature: 0, maxTokens: 100 },
    browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false } },
    recovery: { maxAttemptsPerTask: 2, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], treatThirdPartyNetwork5xxAsBug: false },
    privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
    output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
    evidence: { video: 'off', trace: 'off' },
    scenarioSelection: { maxScenarios: 5 },
    reporting: { manualMinutesPerScenario: minutesPerScenario },
    monitor: { enabled: false, stallThresholdMs: 30000, checkIntervalMs: 3000 },
    agentVersion: '0.1.0',
  } as unknown as RunConfig;
}

function makeResult(durationMs?: number): QaRunResult {
  return {
    status: 'PASSED',
    runDir: '/tmp/run-001',
    steps: [],
    bugs: [],
    scenarios: [
      { id: 's1', title: 'A', status: 'PASSED', tasks: [] },
      { id: 's2', title: 'B', status: 'FAILED', tasks: [] },
    ],
    metrics: durationMs ? { totalDurationMs: durationMs, totalScenarios: 2, passedScenarios: 1, failedScenarios: 1, blockedScenarios: 0, totalTasks: 2, passedTasks: 1, failedTasks: 1, skippedTasks: 0, totalSteps: 5, passedSteps: 4, failedSteps: 1, totalBugs: 1, bugsBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 } } : undefined,
  };
}

describe('QaValueMetricsCalculatorService', () => {
  it('computes metrics with duration', () => {
    const config = makeConfig(10);
    const result = makeResult(480000);
    const metrics = calculator.compute(result, config);
    expect(metrics.scenariosExecuted).toBe(2);
    expect(metrics.estimatedManualMinutes).toBe(20);
    expect(metrics.agentExecutionMinutes).toBe(8);
    expect(metrics.estimatedMinutesSaved).toBe(12);
    expect(metrics.bugsFound).toBe(1);
    expect(metrics.acceptanceCriteriaCovered).toBe(0);
    expect(metrics.acceptanceCriteriaTotal).toBe(2);
  });

  it('clamps saved time to zero when agent takes longer than manual estimate', () => {
    const config = makeConfig(1);
    const result = makeResult(600000);
    const metrics = calculator.compute(result, config);
    expect(metrics.estimatedManualMinutes).toBe(2);
    expect(metrics.agentExecutionMinutes).toBe(10);
    expect(metrics.estimatedMinutesSaved).toBe(0);
  });

  it('returns zeros when no duration available', () => {
    const config = makeConfig(10);
    const result = makeResult(undefined);
    const metrics = calculator.compute(result, config);
    expect(metrics.scenariosExecuted).toBe(2);
    expect(metrics.agentExecutionMinutes).toBe(0);
    expect(metrics.estimatedMinutesSaved).toBe(0);
  });

  it('uses default manualMinutesPerScenario when reporting missing', () => {
    const config = makeConfig(undefined as unknown as number);
    const result = makeResult(300000);
    const metrics = calculator.compute(result, config);
    expect(metrics.estimatedManualMinutes).toBe(20);
  });
});
