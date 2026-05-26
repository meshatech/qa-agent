import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectOnboardingService } from '../src/application/services/project-onboarding.service.js';
import { PlanExecutorService } from '../src/application/services/plan-executor.service.js';
import { RunHistoryService } from '../src/application/services/run-history.service.js';
import { DataHarnessService } from '../src/application/services/data-harness.service.js';
import { SanitizerService } from '../src/application/services/sanitizer.service.js';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { RecoveryPolicyService } from '../src/application/services/recovery-policy.service.js';
import { ElementAvailabilityResolver } from '../src/application/services/element-availability-resolver.service.js';
import { TaskMemoryService } from '../src/application/services/task-memory.service.js';
import { PlanReplannerService } from '../src/application/services/plan-replanner.service.js';
import { ReadinessEvaluatorService } from '../src/application/services/readiness-evaluator.service.js';
import { BaselineSmokeBuilderService } from '../src/application/services/baseline-smoke-builder.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { BrowserHarnessPort } from '../src/application/ports/browser-harness.port.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';
import type { PlanExecutionResult } from '../src/application/services/plan-executor.service.js';

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-onboarding-'));
  tempDirs.push(dir);
  return dir;
}

function makeObservation(
  url: string,
  texts: string[] = [],
  opts: { elements?: ScreenObservation['elements']; networkSignals?: ScreenObservation['networkSignals'] } = {},
): ScreenObservation {
  return {
    observationId: `obs-${Date.now()}`,
    createdAt: new Date().toISOString(),
    url,
    title: 'App',
    visibleTexts: texts,
    elements: opts.elements ?? [],
    pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
    consoleSignals: [],
    networkSignals: opts.networkSignals ?? [],
    meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
  };
}

function makeBrowser(opts: { openFail?: boolean } = {}): BrowserHarnessPort {
  return {
    async open() {
      if (opts.openFail) throw new Error('Browser launch failed');
    },
    async observe() {
      return makeObservation('https://app.local/', [], {
        networkSignals: [{ method: 'GET', url: 'https://app.local/', status: 200, isAppOrigin: true, timestamp: new Date().toISOString() }],
        elements: [{ id: 'el_001', role: 'heading', name: 'App', inViewport: true, locator: { strategy: 'text', text: 'App' } }],
      });
    },
    async execute(action) {
      return { ok: true, actionType: action.type, durationMs: 1 };
    },
    async validate(expected) {
      return { ok: true, type: expected.type, durationMs: 1 };
    },
    async waitForQuiescence() {
      return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 };
    },
    async captureAuth() {},
    async screenshot() { return undefined; },
    async domSnapshot() { return undefined; },
    networkLog() { return []; },
    consoleLog() { return ''; },
    async saveTrace() {},
    async saveVideo() {},
    async close() {},
  };
}

function makePlanExecutor(result: Partial<PlanExecutionResult> = {}): PlanExecutorService {
  const browser = makeBrowser();
  const recovery = new RecoveryPolicyService(browser);
  const replanner = { replan: async () => { throw new Error('no replanner'); } } as unknown as PlanReplannerService;
  const locators = new LocatorResolverService();
  const executor = new PlanExecutorService(
    browser,
    locators,
    new DataHarnessService(),
    new ActionPolicyService(),
    new ElementAvailabilityResolver(browser, locators),
    recovery,
    new TaskMemoryService(),
    replanner,
  );

  vi.spyOn(executor, 'execute').mockResolvedValue({
    ok: true,
    steps: [],
    attempts: [],
    warnings: [],
    finalPlan: {
      schemaVersion: 'execution-plan.v1',
      planId: 'onboarding-smoke',
      version: 1,
      goal: 'Smoke',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      steps: [],
      assertions: [],
    },
    patchHistory: [],
    evaluations: [],
    ...result,
  });

  return executor;
}

function makeService(opts: { browser?: BrowserHarnessPort; executor?: PlanExecutorService } = {}) {
  const browser = opts.browser ?? makeBrowser();
  const executor = opts.executor ?? makePlanExecutor();
  const history = new RunHistoryService(new SanitizerService());
  return new ProjectOnboardingService(browser, executor, history, new DataHarnessService(), new ReadinessEvaluatorService(), new BaselineSmokeBuilderService());
}

describe('ProjectOnboardingService', () => {
  it('returns READY when smoke executes successfully', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const service = makeService();
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.readiness).toBe('READY');
    expect(result.warnings).toEqual([]);
    expect(result.baselineReportPath).toBe(join(outputDir, 'baseline-report.md'));

    const report = await readFile(result.baselineReportPath!, 'utf8');
    expect(report).toContain('Readiness:** READY');
    expect(report).toContain('Onboarding failures are classified as ONBOARDING_BLOCKED');

    const historyLines = await new RunHistoryService(new SanitizerService()).readLines(projectPath);
    expect(historyLines.length).toBeGreaterThan(0);
    expect(historyLines[historyLines.length - 1]?.status).toBe('passed');
  });

  it('returns ONBOARDING_BLOCKED when smoke fails, never as a product bug', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const executor = makePlanExecutor({
      ok: false,
      failedMessage: 'Navigation timeout',
      steps: [],
      attempts: [],
      warnings: [{ stepId: 'ONB-001', message: 'Navigation timeout' }],
      finalPlan: {
        schemaVersion: 'execution-plan.v1',
        planId: 'onboarding-smoke',
        version: 1,
        goal: 'Smoke',
        mode: 'PLAN_AND_EXECUTE',
        runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
        steps: [],
        assertions: [],
      },
      patchHistory: [],
      evaluations: [],
    });

    const service = makeService({ executor });
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.readiness).toBe('ONBOARDING_BLOCKED');
    expect(result.warnings).toContain('Onboarding failed: Navigation timeout');
    expect(result.baselineReportPath).toBe(join(outputDir, 'baseline-report.md'));

    const report = await readFile(result.baselineReportPath!, 'utf8');
    expect(report).toContain('Readiness:** ONBOARDING_BLOCKED');
    expect(report).not.toContain('BUG');

    const historyLines = await new RunHistoryService(new SanitizerService()).readLines(projectPath);
    expect(historyLines[historyLines.length - 1]?.status).toBe('blocked');
  });

  it('returns ONBOARDING_BLOCKED when browser fails to open', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const browser = makeBrowser({ openFail: true });
    const service = makeService({ browser });
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.readiness).toBe('ONBOARDING_BLOCKED');
    expect(result.warnings.some((w) => w.includes('Browser open failed'))).toBe(true);
  });

  it('warns when minimal smoke returns non-200 HTTP status', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const browser: BrowserHarnessPort = {
      ...makeBrowser(),
      async observe() {
        return makeObservation('https://app.local/', [], {
          networkSignals: [{ method: 'GET', url: 'https://app.local/', status: 500, isAppOrigin: true, timestamp: new Date().toISOString() }],
          elements: [{ id: 'el_001', role: 'heading', name: 'App', inViewport: true, locator: { strategy: 'text', text: 'App' } }],
        });
      },
    };

    const service = makeService({ browser });
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.warnings.some((w) => w.includes('HTTP 500') && w.includes('expected 200'))).toBe(true);
  });

  it('warns when DOM is empty after navigation', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const browser: BrowserHarnessPort = {
      ...makeBrowser(),
      async observe() {
        return makeObservation('https://app.local/', [], {
          networkSignals: [{ method: 'GET', url: 'https://app.local/', status: 200, isAppOrigin: true, timestamp: new Date().toISOString() }],
          elements: [],
        });
      },
    };

    const service = makeService({ browser });
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.warnings.some((w) => w.includes('DOM appears empty'))).toBe(true);
  });

  it('includes login steps in smoke plan when auth is formLogin and credentials exist', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      auth: {
        kind: 'formLogin',
        loginUrl: 'https://app.local/login',
        usernameSelector: '#username',
        passwordSelector: '#password',
        submitSelector: { strategy: 'role', role: 'button', name: 'Entrar' },
        usernameEnv: 'TEST_USER',
        passwordEnv: 'TEST_PASS',
        successUrlContains: '/dashboard',
      },
    });

    process.env.TEST_USER = 'alice';
    process.env.TEST_PASS = 'secret';

    const executor = makePlanExecutor();
    const executeSpy = vi.spyOn(executor, 'execute');
    const service = makeService({ executor });

    await service.execute(config, outputDir, projectPath);

    const plan = executeSpy.mock.calls[0]?.[0];
    expect(plan).toBeDefined();
    expect(plan.steps.map((s: { id: string }) => s.id)).toContain('ONB-002');
    expect(plan.steps.map((s: { id: string }) => s.id)).toContain('ONB-003');
    expect(plan.steps.map((s: { id: string }) => s.id)).toContain('ONB-004');

    delete process.env.TEST_USER;
    delete process.env.TEST_PASS;
  });

  it('includes a warning step when formLogin credentials are missing', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      auth: {
        kind: 'formLogin',
        loginUrl: 'https://app.local/login',
        usernameSelector: '#username',
        passwordSelector: '#password',
        submitSelector: { strategy: 'role', role: 'button', name: 'Entrar' },
        usernameEnv: 'MISSING_USER_ENV',
        passwordEnv: 'MISSING_PASS_ENV',
      },
    });

    const executor = makePlanExecutor();
    const executeSpy = vi.spyOn(executor, 'execute');
    const service = makeService({ executor });

    await service.execute(config, outputDir, projectPath);

    const plan = executeSpy.mock.calls[0]?.[0];
    expect(plan).toBeDefined();
    expect(plan.steps.map((s: { id: string }) => s.id)).toContain('ONB-002-WARN');
  });

  it('reads baseUrl from RunConfig', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const service = makeService();
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.readiness).toBe('READY');
  });

  it('adds warning when formLogin auth credentials are missing', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      auth: {
        kind: 'formLogin',
        loginUrl: 'https://app.local/login',
        usernameSelector: '#username',
        passwordSelector: '#password',
        submitSelector: 'button',
        usernameEnv: 'MISSING_USER',
        passwordEnv: 'MISSING_PASS',
      },
    });

    const service = makeService();
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.warnings.some((w) => w.includes('credentials missing'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('MISSING_USER'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('MISSING_PASS'))).toBe(true);
  });

  it('coerces string auth selectors into LocatorDescriptor', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      auth: {
        kind: 'formLogin',
        loginUrl: 'https://app.local/login',
        usernameSelector: '#username',
        passwordSelector: '#password',
        submitSelector: 'button[type="submit"]',
        usernameEnv: 'TEST_USER',
        passwordEnv: 'TEST_PASS',
      },
    });

    process.env.TEST_USER = 'alice';
    process.env.TEST_PASS = 'secret';

    const executor = makePlanExecutor();
    const executeSpy = vi.spyOn(executor, 'execute');
    const service = makeService({ executor });

    await service.execute(config, outputDir, projectPath);

    const plan = executeSpy.mock.calls[0]?.[0];
    const fillStep = plan.steps.find((s: { id: string; action: { type: string } }) => s.id === 'ONB-002');
    expect(fillStep?.action.type).toBe('fill');
    expect((fillStep!.action as { target: { strategy: string; text: string } }).target).toEqual({ strategy: 'text', text: '#username' });

    delete process.env.TEST_USER;
    delete process.env.TEST_PASS;
  });

  it('validates allowedRoutes and reports accessible routes', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      allowedRoutes: ['/dashboard', '/profile'],
    });

    const service = makeService();
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.warnings.some((w) => w.includes('/dashboard') && w.includes('HTTP'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('/profile') && w.includes('HTTP'))).toBe(false);
    expect(result.readiness).toBe('READY');
  });

  it('reports blocked allowedRoutes with warnings', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      allowedRoutes: ['/blocked'],
    });

    let callCount = 0;
    const browser: BrowserHarnessPort = {
      ...makeBrowser(),
      async observe() {
        callCount++;
        // First call = minimalSmoke (baseUrl), subsequent = route checks
        if (callCount === 1) {
          return makeObservation('https://app.local/', [], {
            networkSignals: [{ method: 'GET', url: 'https://app.local/', status: 200, isAppOrigin: true, timestamp: new Date().toISOString() }],
            elements: [{ id: 'el_001', role: 'heading', name: 'App', inViewport: true, locator: { strategy: 'text', text: 'App' } }],
          });
        }
        return makeObservation('https://app.local/blocked', [], {
          networkSignals: [{ method: 'GET', url: 'https://app.local/blocked', status: 403, isAppOrigin: true, timestamp: new Date().toISOString() }],
          elements: [{ id: 'el_001', role: 'heading', name: 'Blocked', inViewport: true, locator: { strategy: 'text', text: 'Blocked' } }],
        });
      },
    };

    const service = makeService({ browser });
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.warnings.some((w) => w.includes('/blocked') && w.includes('HTTP 403'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('expected 200'))).toBe(true);
  });

  it('reports blocked route when DOM is empty', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      allowedRoutes: ['/empty'],
    });

    let callCount = 0;
    const browser: BrowserHarnessPort = {
      ...makeBrowser(),
      async observe() {
        callCount++;
        if (callCount === 1) {
          return makeObservation('https://app.local/', [], {
            networkSignals: [{ method: 'GET', url: 'https://app.local/', status: 200, isAppOrigin: true, timestamp: new Date().toISOString() }],
            elements: [{ id: 'el_001', role: 'heading', name: 'App', inViewport: true, locator: { strategy: 'text', text: 'App' } }],
          });
        }
        return makeObservation('https://app.local/empty', [], {
          networkSignals: [{ method: 'GET', url: 'https://app.local/empty', status: 200, isAppOrigin: true, timestamp: new Date().toISOString() }],
          elements: [],
        });
      },
    };

    const service = makeService({ browser });
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.warnings.some((w) => w.includes('/empty') && w.includes('DOM empty'))).toBe(true);
  });

  it('executes baseline via PlanExecutorService', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const executor = makePlanExecutor();
    const executeSpy = vi.spyOn(executor, 'execute');
    const service = makeService({ executor });

    await service.execute(config, outputDir, projectPath);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const plan = executeSpy.mock.calls[0]?.[0];
    expect(plan.planId).toBe('onboarding-smoke');
    expect(plan.schemaVersion).toBe('execution-plan.v1');
  });

  it('captures PlanExecutionResult correctly', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const executor = makePlanExecutor({
      ok: true,
      warnings: [{ stepId: 'ONB-001', message: 'Minor console warning' }],
    });

    const service = makeService({ executor });
    const result = await service.execute(config, outputDir, projectPath);

    expect(result.readiness).toBe('READY');
    expect(result.warnings).toContain('ONB-001: Minor console warning');
    expect(result.baselineReportPath).not.toBeNull();
  });

  it('reuses existing PlanExecutorService infrastructure', async () => {
    const outputDir = await tempDir();
    const projectPath = await tempDir();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const executor = makePlanExecutor();
    const service = makeService({ executor });
    const result = await service.execute(config, outputDir, projectPath);

    // Should NOT duplicate execution logic; result comes from the injected executor
    expect(result.readiness).toBe('READY');
  });
});
