import { Inject, Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { ZodError } from 'zod';
import { RunAgentDtoSchema, type RunAgentDto } from '../dto/run-agent.dto.js';
import { RunConfigSchema, type RunConfig } from '../../domain/schemas/config.schema.js';
import type { AttemptRecord, BugSignalType, QaBug, QaRunMetrics, QaRunResult, QaScenario, QaStep, QaTask } from '../../domain/models/run.model.js';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import { ConfigError, HarnessFatalError, RunTimeoutError } from '../../domain/errors.js';
import { DomainError } from '../../domain/shared/result.js';
import { DataHarnessService } from '../services/data-harness.service.js';
import { LocatorResolverService } from '../services/locator-resolver.service.js';
import { ValidationBinderService } from '../services/validation-binder.service.js';
import { ActionPolicyService } from '../services/action-policy.service.js';
import { RecoveryPolicyService } from '../services/recovery-policy.service.js';
import { SanitizerService } from '../services/sanitizer.service.js';
import { BugClassifierService } from '../services/bug-classifier.service.js';
import { EvidenceService } from '../services/evidence.service.js';
import { ScenarioPlannerService } from '../services/scenario-planner.service.js';
import { ValidateConfigUseCase } from './validate-config.usecase.js';

@Injectable()
export class RunAgentUseCase {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
    @Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort,
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
    @Inject(DataHarnessService) private readonly data: DataHarnessService,
    @Inject(LocatorResolverService) private readonly locators: LocatorResolverService,
    @Inject(ValidationBinderService) private readonly binder: ValidationBinderService,
    @Inject(ActionPolicyService) private readonly actionPolicy: ActionPolicyService,
    @Inject(RecoveryPolicyService) private readonly recovery: RecoveryPolicyService,
    @Inject(SanitizerService) private readonly sanitizer: SanitizerService,
    @Inject(BugClassifierService) private readonly bugClassifier: BugClassifierService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(ScenarioPlannerService) private readonly planner: ScenarioPlannerService,
    @Inject(ValidateConfigUseCase) private readonly validateConfig: ValidateConfigUseCase,
  ) {}

  async execute(rawDto: RunAgentDto): Promise<QaRunResult> {
    const startedAt = new Date();
    const dto = this.parseDto(rawDto);
    const config = await this.loadConfig(dto);
    this.applyOverrides(config, dto);
    if (dto.demandPath) config.demand.description = await readFile(dto.demandPath, 'utf8');
    await this.validateConfig.validateLoaded(config);

    this.data.reset();
    const runDir = await this.repo.createRunDir(config);
    const runId = runDir.split(/[\\/]/).pop()!;

    const scenarios = await this.planner.plan(config);
    const filtered = dto.scenarioId ? scenarios.filter((s) => s.id === dto.scenarioId) : scenarios.slice(0, dto.maxScenarios ?? scenarios.length);
    await this.repo.writeJson(runDir, 'execution-plan.json', filtered);

    const result: QaRunResult = { status: 'PASSED', runDir, scenarios: filtered, steps: [], bugs: [], startedAt: startedAt.toISOString() };
    if (dto.dryRun) return this.finalize(result, config, [], startedAt, runId, false);

    return this.withTimeout(config.timeouts.runMs, () => this.runWithBrowser(result, config, dto, runDir, startedAt, runId));
  }

  private parseDto(raw: RunAgentDto): RunAgentDto {
    try {
      return RunAgentDtoSchema.parse(raw);
    } catch (error) {
      throw new ConfigError(error instanceof ZodError ? error.message : String(error), error);
    }
  }

  private async loadConfig(dto: RunAgentDto): Promise<RunConfig> {
    let raw: unknown;
    try {
      raw = await this.configLoader.load(dto.configPath);
    } catch (error) {
      throw new ConfigError(`Failed to load config from ${dto.configPath}: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    try {
      return RunConfigSchema.parse(raw);
    } catch (error) {
      throw new ConfigError(error instanceof ZodError ? error.message : String(error), error);
    }
  }

  private applyOverrides(config: RunConfig, dto: RunAgentDto): void {
    if (dto.headed !== undefined) config.browser.headed = dto.headed;
    if (dto.outputDir) config.output.runsDir = dto.outputDir;
  }

  private async runWithBrowser(result: QaRunResult, config: RunConfig, dto: RunAgentDto, runDir: string, startedAt: Date, runId: string): Promise<QaRunResult> {
    const attempts: AttemptRecord[] = [];
    try {
      try {
        await this.browser.open(config);
      } catch (error) {
        if (error instanceof HarnessFatalError) throw error;
        throw new HarnessFatalError(error instanceof Error ? error.message : String(error), error);
      }

      for (const scenario of result.scenarios ?? []) {
        scenario.status = 'RUNNING';
        await this.runScenario(scenario, config, dto, runDir, runId, result, attempts);
        scenario.status = this.scenarioStatus(scenario);
        if (this.hasBlockingBug(result) || scenario.status === 'BLOCKED') break;
      }

      result.status = this.runStatus(result);
      return await this.finalize(result, config, attempts, startedAt, runId, true);
    } finally {
      await this.browser.close().catch(() => undefined);
    }
  }

  private async runScenario(scenario: QaScenario, config: RunConfig, dto: RunAgentDto, runDir: string, runId: string, result: QaRunResult, attempts: AttemptRecord[]): Promise<void> {
    void dto;
    for (const task of scenario.tasks) {
      if (task.status !== 'PENDING') continue;
      if (this.depsBlocked(task, scenario.tasks)) {
        task.status = 'SKIPPED';
        attempts.push({ actionType: 'task-skip', result: 'BLOCKED', reason: `dependency blocked: ${task.dependsOn?.join(', ')}`, ts: new Date().toISOString() });
        continue;
      }
      await this.runTask(task, scenario, config, runDir, runId, result, attempts);
    }
  }

  private depsBlocked(task: QaTask, tasks: QaTask[]): boolean {
    if (!task.dependsOn?.length) return false;
    for (const depId of task.dependsOn) {
      const dep = tasks.find((t) => t.id === depId);
      if (!dep || dep.status !== 'PASSED') return true;
    }
    return false;
  }

  private async runTask(task: QaTask, scenario: QaScenario, config: RunConfig, runDir: string, runId: string, result: QaRunResult, attempts: AttemptRecord[]): Promise<void> {
    task.attempts = task.attempts ?? [];
    const maxCycles = Math.max(config.runtime.maxActionsPerTask, config.recovery.maxAttemptsPerTask);
    for (let cycle = 0; cycle < maxCycles; cycle++) {
      let obs = await this.browser.observe();
      this.locators.rebuild(obs);
      if (this.isTaskAlreadySatisfied(task, config, obs)) {
        const step = this.satisfiedStep(`S${String(result.steps.length + 1).padStart(4, '0')}`, scenario.id, task.id, obs.observationId, 'Task already satisfied by current authenticated page state');
        result.steps.push(step);
        task.status = 'PASSED';
        return;
      }
      if (await this.trySemanticLogout(task, scenario, config, runDir, runId, result, attempts, obs)) return;
      const taskConfig = { ...config, demand: { ...config.demand, description: this.taskDecisionContext(task, cycle) } };
      const envelope = await this.decision.decide({ config: taskConfig, observation: obs, runData: this.data.all() });
      const stepId = `S${String(result.steps.length + 1).padStart(4, '0')}`;
      const startedAtIso = new Date().toISOString();

      if (envelope.observationId !== obs.observationId) {
        const blocked = this.blockedStep(stepId, scenario.id, task.id, envelope, this.binder.bind(envelope.expected_after_action, obs), 'STALE_OBSERVATION', 'Envelope observationId is stale', startedAtIso);
        result.steps.push(blocked);
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, blocked, obs, 'Envelope observationId is stale', 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts));
        task.status = 'BLOCKED';
        return;
      }

      let bound: QaStep['boundExpected'];
      try {
        bound = this.binder.bind(envelope.expected_after_action, obs);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const blocked = this.blockedStep(stepId, scenario.id, task.id, envelope, { type: 'no_console_errors' }, error.code as NonNullable<QaStep['error']>['code'], error.message, startedAtIso);
        result.steps.push(blocked);
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, blocked, obs, error.message, 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts));
        task.status = 'BLOCKED';
        return;
      }
      let action: QaStep['resolvedAction'];
      try {
        action = this.data.resolveObject(envelope.action, 'action');
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const blocked = this.blockedStep(stepId, scenario.id, task.id, envelope, bound, error.code as NonNullable<QaStep['error']>['code'], error.message, startedAtIso);
        result.steps.push(blocked);
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, blocked, obs, error.message, 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts));
        task.status = 'BLOCKED';
        return;
      }
      if (this.isPreActionWeakExpected(task, action, bound)) {
        const reason = 'Weak validation: expected_after_action does not prove the requested state change';
        const attempt = { actionType: action.type, result: 'FAILED' as const, reason, ts: new Date().toISOString() };
        attempts.push(attempt);
        task.attempts.push(attempt);
        if (cycle < maxCycles - 1) continue;
        const blocked = this.blockedStep(stepId, scenario.id, task.id, envelope, bound, 'ACTION_SCHEMA_INVALID', reason, startedAtIso);
        result.steps.push(blocked);
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, blocked, obs, reason, 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts));
        task.status = 'BLOCKED';
        return;
      }
      const policy = this.actionPolicy.validate(action, config, attempts);
      if (!policy.ok) {
        const blocked = this.blockedStep(stepId, scenario.id, task.id, envelope, bound, policy.code, policy.message, startedAtIso);
        result.steps.push(blocked);
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, blocked, obs, policy.message, 'NAVIGATION_UNEXPECTED', config, scenario.id, task.id, attempts));
        task.status = 'BLOCKED';
        return;
      }

      const exec = await this.browser.execute(action);
      const taskAttempt: AttemptRecord = { actionType: action.type, result: exec.ok ? 'PASSED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() };
      attempts.push(taskAttempt);
      task.attempts.push(taskAttempt);

      const quiescence = await this.browser.waitForQuiescence(config.timeouts.quiescenceMs);
      if (!quiescence.stable) attempts.push({ actionType: 'waitForQuiescence', result: 'FAILED', reason: 'QUIESCENCE_TIMEOUT', ts: new Date().toISOString() });

      obs = await this.browser.observe();
      this.locators.rebuild(obs);
      const changed = this.observationChanged(envelope.observationId, obs.observationId);
      let expected: QaStep['boundExpected'];
      try {
        expected = this.data.resolveObject(bound, 'assertion');
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const blocked = { ...this.blockedStep(stepId, scenario.id, task.id, envelope, bound, error.code as NonNullable<QaStep['error']>['code'], error.message, startedAtIso), quiescence };
        result.steps.push(blocked);
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, blocked, obs, error.message, 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts));
        task.status = 'BLOCKED';
        return;
      }
      let validation = await this.browser.validate(expected);
      let recoveryApplied = undefined;
      let recoveredOk = false;

      if (!exec.ok || !validation.ok) {
        const recovered = await this.recovery.recover({
          expected,
          fallback: envelope.fallback_action,
          attempts,
          quiescenceMs: config.timeouts.quiescenceMs,
          maxFallbacks: config.recovery.maxFallbacksPerStep,
          maxEmergencyActions: config.recovery.maxEmergencyActionsPerScenario,
        });
        recoveryApplied = recovered.action;
        recoveredOk = recovered.ok;
        obs = await this.browser.observe();
        this.locators.rebuild(obs);
        validation = await this.browser.validate(expected);
      }
      const ok = this.stepSucceeded(task, action, exec.ok, validation.ok, recoveredOk, expected, changed);

      const step: QaStep = {
        stepId,
        scenarioId: scenario.id,
        taskId: task.id,
        observationId: obs.observationId,
        thoughtSummary: envelope.thought_summary,
        confidence: envelope.confidence,
        action: envelope.action,
        resolvedAction: action,
        boundExpected: expected,
        validation,
        recoveryApplied,
        quiescence,
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        error: ok ? undefined : { code: exec.error?.code ?? 'RECOVERY_EXHAUSTED', message: exec.error?.message ?? 'Recovery exhausted' },
      };
      result.steps.push(step);

      if (validation.type === 'no_console_errors' && !validation.ok) {
        task.status = 'BLOCKED';
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, step, obs, validation.actual || 'console errors detected', 'APP_CONSOLE_EXCEPTION', config, scenario.id, task.id, attempts, validation.expected, validation.actual));
        return;
      }

      if (ok) {
        task.status = 'PASSED';
        return;
      }
      if (cycle === maxCycles - 1) {
        task.status = 'BLOCKED';
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, step, obs, validation.actual || 'assertion failed', 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts, validation.expected, validation.actual));
      }
    }
  }

  private blockedStep(stepId: string, scenarioId: string, taskId: string, envelope: { action: QaStep['action']; expected_after_action: unknown }, boundExpected: QaStep['boundExpected'], code: NonNullable<QaStep['error']>['code'], message: string, startedAt: string): QaStep {
    void envelope.expected_after_action;
    return { stepId, scenarioId, taskId, action: envelope.action, resolvedAction: envelope.action, boundExpected, error: { code, message }, startedAt, finishedAt: new Date().toISOString() };
  }

  private async recordBug(runDir: string, runId: string, index: number, step: QaStep, observation: import('../../domain/schemas/observation.schema.js').ScreenObservation | undefined, message: string, signalType: BugSignalType, config: RunConfig, scenarioId: string, taskId: string, attempts: AttemptRecord[], expected?: string, actual?: string): Promise<QaBug> {
    const classification = this.bugClassifier.classify({ signalType, message, source: observation?.url, config });
    return this.evidence.record(runDir, {
      bugId: `BUG-${String(index).padStart(3, '0')}`,
      step,
      observation,
      classification,
      config,
      scenarioId,
      taskId,
      attempts,
      signalType,
      rawMessage: message,
      url: observation?.url,
      expected,
      actual,
      runId,
    });
  }

  private taskDecisionContext(task: QaTask, cycle: number): string {
    const base = [
      `Task: ${task.title}`,
      `Expected result: ${task.expected}`,
      'Choose an action that directly advances this task.',
      'The expected_after_action must prove the task result, not merely that the clicked element remains visible.',
      'For functional tasks, no_console_errors is only a secondary safety check and is not enough to complete the task.',
      'For logout/sign-out tasks, prove logout with login screen text, login form visibility, or a URL that clearly moved to /login, /signin, or another non-authenticated route.',
    ];
    const recent = task.attempts?.slice(-3) ?? [];
    if (cycle > 0 && recent.length) {
      base.push('Previous failed attempts:');
      base.push(...recent.map((a) => `- ${a.actionType}: ${a.reason ?? a.result}`));
      base.push('Do not repeat the same weak action/validation. Pick another element, open a menu first, or use a stronger expected_after_action such as visible text, changed URL, or visible menu item.');
    }
    return base.join('\n');
  }

  private stepSucceeded(task: QaTask, action: QaStep['resolvedAction'], execOk: boolean, validationOk: boolean, recoveredOk: boolean, expected: QaStep['boundExpected'], changed: boolean): boolean {
    if (!validationOk) return false;
    if (this.isLogoutTask(task) && !this.isLogoutProof(expected)) return false;
    if (expected.type === 'no_console_errors' && !this.isConsoleSafetyTask(task)) return execOk && changed;
    if (execOk) return true;
    if (action.type === 'assertVisible' || action.type === 'assertText' || action.type === 'abortScenario') return false;
    return recoveredOk;
  }

  private isPreActionWeakExpected(task: QaTask, action: QaStep['resolvedAction'], expected: QaStep['boundExpected']): boolean {
    void task;
    if (!('targetElementId' in action) || !action.targetElementId) return false;
    if (expected.type !== 'element_visible' || !expected.target) return false;
    return expected.target.originalElementId === action.targetElementId;
  }

  private observationChanged(beforeId: string, afterId: string): boolean {
    return beforeId !== afterId;
  }

  private isConsoleSafetyTask(task: QaTask): boolean {
    const text = `${task.title} ${task.expected}`.toLowerCase();
    return /(console|erro crítico|critical error|javascript error|sem erro|no console)/i.test(text);
  }

  private isLogoutTask(task: QaTask): boolean {
    const text = `${task.title} ${task.expected}`.toLowerCase();
    return /\b(logout|deslogar|sair|encerrar sessão|sign out)\b/i.test(text);
  }

  private async trySemanticLogout(task: QaTask, scenario: QaScenario, config: RunConfig, runDir: string, runId: string, result: QaRunResult, attempts: AttemptRecord[], obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): Promise<boolean> {
    if (!this.isLogoutTask(task)) return false;
    const target = obs.elements.find((e) => e.inViewport && /(sair|logout|sign out|encerrar sessão)/i.test(`${e.name} ${e.text ?? ''}`));
    if (!target) return false;

    const stepId = `S${String(result.steps.length + 1).padStart(4, '0')}`;
    const startedAt = new Date().toISOString();
    const action = { type: 'click' as const, targetElementId: target.id, reason: `semantic logout via "${target.name}"` };
    const exec = await this.browser.execute(action);
    const attempt: AttemptRecord = { actionType: action.type, result: exec.ok ? 'PASSED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() };
    attempts.push(attempt);
    task.attempts?.push(attempt);
    const quiescence = await this.browser.waitForQuiescence(config.timeouts.quiescenceMs);
    const after = await this.browser.observe();
    this.locators.rebuild(after);
    const validation = this.logoutObservationValidation(after);
    const step: QaStep = {
      stepId,
      scenarioId: scenario.id,
      taskId: task.id,
      observationId: after.observationId,
      thoughtSummary: `Semantic logout clicked visible item "${target.name}".`,
      confidence: 1,
      action,
      resolvedAction: action,
      boundExpected: validation.boundExpected,
      validation: validation.result,
      quiescence,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: exec.ok && validation.result.ok ? undefined : { code: exec.error?.code ?? 'ASSERTION_FAILED', message: exec.error?.message ?? 'Logout was not proven' },
    };
    result.steps.push(step);
    if (exec.ok && validation.result.ok) {
      task.status = 'PASSED';
      return true;
    }
    if ((task.attempts?.length ?? 0) >= Math.max(config.runtime.maxActionsPerTask, config.recovery.maxAttemptsPerTask)) {
      task.status = 'BLOCKED';
      result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, step, after, validation.result.actual || 'logout was not proven', 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts, validation.result.expected, validation.result.actual));
      return true;
    }
    return false;
  }

  private logoutObservationValidation(obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): { boundExpected: QaStep['boundExpected']; result: NonNullable<QaStep['validation']> } {
    const url = obs.url.toLowerCase();
    const loginRoute = /\/(login|signin|sign-in|auth)\b/.test(url);
    const loginText = [...obs.visibleTexts, ...obs.elements.flatMap((e) => [e.name, e.text ?? ''])].some((text) => /\b(entrar|login|e-mail|email|senha|acessar|sign in)\b/i.test(text));
    const ok = loginRoute || loginText;
    return {
      boundExpected: loginRoute ? { type: 'url_contains', value: '/login' } : { type: 'text_visible', text: 'Entrar/Login/E-mail/Senha' },
      result: { ok, type: 'logout_state', expected: 'non-authenticated login state', actual: ok ? obs.url : `${obs.url} :: ${obs.visibleTexts.slice(0, 5).join(' | ')}`, durationMs: 0 },
    };
  }

  private isLogoutProof(expected: QaStep['boundExpected']): boolean {
    if (expected.type === 'url_contains') return /(login|signin|sign-in|auth)/i.test(expected.value);
    if (expected.type === 'text_visible') return /(entrar|login|email|senha|acessar|sign in)/i.test(expected.text);
    if (expected.type === 'element_visible') return Boolean(expected.text && /(entrar|login|email|senha|acessar|sign in)/i.test(expected.text));
    return false;
  }

  private isTaskAlreadySatisfied(task: QaTask, config: RunConfig, obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): boolean {
    if (config.auth.kind === 'none') return false;
    const text = `${task.title} ${task.expected}`.toLowerCase();
    const authCheck = /(área autenticada|area autenticada|authenticated area|tela autenticada)/i.test(text);
    if (!authCheck) return false;
    const url = obs.url.toLowerCase();
    if (/\/(login|signin|sign-in)\b/.test(url)) return false;
    const hasAppSurface = obs.elements.some((e) => ['button', 'link', 'textbox', 'searchbox'].includes(e.role) && e.inViewport);
    return hasAppSurface && obs.visibleTexts.length > 0;
  }

  private satisfiedStep(stepId: string, scenarioId: string, taskId: string, observationId: string, reason: string): QaStep {
    return {
      stepId,
      scenarioId,
      taskId,
      observationId,
      action: { type: 'waitForStable', timeoutMs: 1000, reason },
      resolvedAction: { type: 'waitForStable', timeoutMs: 1000, reason },
      boundExpected: { type: 'no_console_errors' },
      validation: { ok: true, type: 'state_already_satisfied', expected: reason, durationMs: 0 },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  private async finalize(result: QaRunResult, config: RunConfig, attempts: AttemptRecord[], startedAt: Date, runId: string, capturePassArtifacts: boolean): Promise<QaRunResult> {
    result.metrics = this.metrics(result, startedAt);
    result.finishedAt = new Date().toISOString();
    if (capturePassArtifacts && result.status === 'PASSED') {
      if (config.output.keepTraceOnPass) await this.browser.saveTrace(`${result.runDir}/artifacts/traces/run-trace.zip`).catch(() => undefined);
      if (config.output.keepVideoOnPass) await this.browser.saveVideo(`${result.runDir}/artifacts/videos/run-video.webm`).catch(() => undefined);
    }
    await this.repo.writeJson(result.runDir, 'config.json', this.sanitizer.sanitize(config));
    await this.repo.writeJson(result.runDir, 'run-data.json', this.sanitizer.sanitize(this.data.all()));
    await this.repo.writeJson(result.runDir, 'execution-log.json', this.sanitizer.sanitize({ version: 'log.v1', runId, attempts, steps: result.steps, bugs: result.bugs }));
    if (result.scenarios) await this.repo.writeJson(result.runDir, 'execution-plan.json', this.sanitizer.sanitize(result.scenarios));
    await this.repo.writeJson(result.runDir, 'metrics.json', result.metrics);
    await this.repo.writeJson(result.runDir, 'run.json', this.sanitizer.sanitize({ schemaVersion: 'run.v1', runId, ...result }));
    await this.repo.writeReport(result.runDir, result, config, runId);
    return result;
  }

  private metrics(result: QaRunResult, startedAt: Date): QaRunMetrics {
    const scenarios = result.scenarios ?? [];
    const bugs = result.bugs ?? [];
    const tasks = scenarios.flatMap((s) => s.tasks);
    const bugsBySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } as QaRunMetrics['bugsBySeverity'];
    for (const b of bugs) bugsBySeverity[b.classification.severity]++;
    return {
      totalScenarios: scenarios.length,
      passedScenarios: scenarios.filter((s) => s.status === 'PASSED').length,
      failedScenarios: scenarios.filter((s) => s.status === 'FAILED').length,
      blockedScenarios: scenarios.filter((s) => s.status === 'BLOCKED' || s.status === 'PARTIAL').length,
      totalTasks: tasks.length,
      passedTasks: tasks.filter((t) => t.status === 'PASSED').length,
      failedTasks: tasks.filter((t) => t.status === 'FAILED').length,
      skippedTasks: tasks.filter((t) => t.status === 'SKIPPED').length,
      totalSteps: result.steps.length,
      passedSteps: result.steps.filter((s) => s.validation?.ok).length,
      failedSteps: result.steps.filter((s) => s.validation && !s.validation.ok).length,
      totalBugs: bugs.length,
      bugsBySeverity,
      totalDurationMs: Date.now() - startedAt.getTime(),
      llmCalls: this.decision.stats?.().calls ?? 0,
      sanitization: this.sanitizer.stats(),
    };
  }

  private scenarioStatus(scenario: QaScenario): QaScenario['status'] {
    if (scenario.tasks.every((t) => t.status === 'PASSED')) return 'PASSED';
    if (scenario.tasks.some((t) => t.status === 'BLOCKED')) return 'BLOCKED';
    if (scenario.tasks.some((t) => t.status === 'FAILED')) return 'FAILED';
    if (scenario.tasks.some((t) => t.status === 'PASSED')) return 'PARTIAL';
    return 'PLANNED';
  }

  private runStatus(result: QaRunResult): QaRunResult['status'] {
    const bugs = result.bugs ?? [];
    if (bugs.some((b) => b.classification.severity === 'CRITICAL' || b.classification.severity === 'HIGH')) return 'BLOCKED';
    if ((result.scenarios ?? []).some((s) => s.status === 'FAILED' || s.status === 'BLOCKED')) return 'FAILED';
    return 'PASSED';
  }

  private hasBlockingBug(result: QaRunResult): boolean {
    return (result.bugs ?? []).some((b) => b.classification.isBug && (b.classification.severity === 'HIGH' || b.classification.severity === 'CRITICAL'));
  }

  private async withTimeout<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RunTimeoutError(`Run exceeded total timeout of ${timeoutMs}ms`, timeoutMs)), timeoutMs);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
