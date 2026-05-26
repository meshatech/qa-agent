import { RunConfigSchema, type RunConfig } from '../../domain/schemas/config.schema.js';
import { RunAgentDtoSchema, type RunAgentDto } from '../dto/run-agent.dto.js';
import { Inject, Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { ZodError } from 'zod';

import type { AttemptRecord, BugSignalType, QaBug, QaRunMetrics, QaRunResult, QaScenario, QaStep, QaTask } from '../../domain/models/run.model.js';
import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';
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
import { TaskMemoryService } from '../services/task-memory.service.js';
import { ValidateConfigUseCase } from './validate-config.usecase.js';
import { ExecutionPlanPlannerService, type ExecutionPlanSource } from '../services/execution-plan-planner.service.js';
import { PlanExecutorService, type PlanExecutionResult } from '../services/plan-executor.service.js';
import { PlaywrightSpecExporter } from '../services/playwright-spec-exporter.service.js';
import type { ExecutionPlan } from '../../domain/schemas/execution-plan.schema.js';
import { QaToolRegistry } from '../tools/qa-tool-registry.js';
import type { QaToolContext } from '../tools/qa-tool-context.js';
import { MemorySearchService } from '../services/memory-search.service.js';

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
    @Inject(TaskMemoryService) private readonly memory: TaskMemoryService,
    @Inject(ValidateConfigUseCase) private readonly validateConfig: ValidateConfigUseCase,
    @Inject(ExecutionPlanPlannerService) private readonly executionPlanPlanner: ExecutionPlanPlannerService,
    @Inject(PlanExecutorService) private readonly planExecutor: PlanExecutorService,
    @Inject(PlaywrightSpecExporter) private readonly specExporter: PlaywrightSpecExporter,
    @Inject(MemorySearchService) private readonly memorySearch: MemorySearchService,
    @Inject(QaToolRegistry) private readonly toolRegistry: QaToolRegistry,
  ) { }

  async execute(rawDto: RunAgentDto): Promise<QaRunResult> {
    const startedAt = new Date();
    const dto = this.parseDto(rawDto);
    const config = await this.loadConfig(dto);
    this.applyOverrides(config, dto);
    if (dto.demandPath) config.demand.description = await readFile(dto.demandPath, 'utf8');
    await this.validateConfig.validateLoaded(config);

    this.data.reset();
    this.memory.reset();
    const runDir = await this.repo.createRunDir(config);
    const runId = runDir.split(/[\\/]/).pop()!;

    const scenarios = await this.planner.plan(config);
    const filtered = dto.scenarioId ? scenarios.filter((s) => s.id === dto.scenarioId) : scenarios.slice(0, dto.maxScenarios ?? scenarios.length);
    const useTools = config.runtime.tools?.enabled && config.runtime.mode !== 'FULL_REACTIVE';
    const planned = config.runtime.mode === 'FULL_REACTIVE'
      ? { plan: undefined, source: 'manual' as ExecutionPlanSource }
      : useTools
        ? { plan: undefined, source: 'manual' as ExecutionPlanSource }
        : await this.executionPlanPlanner.build(config, filtered);
    await this.repo.writeJson(runDir, 'generated-execution-plan.json', planned.plan ?? filtered);
    await this.repo.writeJson(runDir, 'execution-plan.json', planned.plan ?? filtered);

    const result: QaRunResult = { status: 'PASSED', runDir, scenarios: filtered, steps: [], bugs: [], startedAt: startedAt.toISOString() };
    (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime = {
      plannerProvider: config.llm.provider,
      plannerModel: config.llm.model,
      planSource: planned.source,
      planVersion: planned.plan?.version,
      fallbackReason: planned.fallbackReason,
      fallbackWarning: planned.fallbackReason ? this.plannerFallbackWarning(planned.fallbackReason) : undefined,
    };
    if (dto.dryRun) return this.finalize(result, config, [], startedAt, runId, false);

    if (useTools) {
      return this.withTimeout(config.timeouts.runMs, () => this.runWithTools(result, config, dto, runDir, startedAt, runId));
    }

    return this.withTimeout(config.timeouts.runMs, () => this.runWithBrowser(result, config, dto, runDir, startedAt, runId, planned.plan));
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

  private plannerFallbackWarning(reason: string): string {
    return /semantically unsafe/i.test(reason)
      ? 'LLM buildPlan was rejected by semantic policy; safe factory fallback was used.'
      : 'LLM buildPlan failed schema/provider validation; safe factory fallback was used.';
  }

  private plannerFallbackCode(reason: string): string {
    return /semantically unsafe/i.test(reason)
      ? 'LLM_BUILD_PLAN_REJECTED_BY_POLICY'
      : 'LLM_BUILD_PLAN_FALLBACK_TO_FACTORY';
  }

  private async runWithBrowser(result: QaRunResult, config: RunConfig, dto: RunAgentDto, runDir: string, startedAt: Date, runId: string, executionPlan?: ExecutionPlan): Promise<QaRunResult> {
    const attempts: AttemptRecord[] = [];
    try {
      try {
        await this.browser.open(config);
      } catch (error) {
        if (error instanceof HarnessFatalError) throw error;
        throw new HarnessFatalError(error instanceof Error ? error.message : String(error), error);
      }

      if (executionPlan && config.runtime.mode !== 'FULL_REACTIVE') {
        await this.runExecutionPlan(executionPlan, result, config, attempts, runDir, runId);
        result.status = this.runStatus(result);
        return await this.finalize(result, config, attempts, startedAt, runId, true);
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

  private async runExecutionPlan(executionPlan: ExecutionPlan, result: QaRunResult, config: RunConfig, attempts: AttemptRecord[], runDir: string, runId: string): Promise<void> {
    for (const scenario of result.scenarios ?? []) scenario.status = 'RUNNING';
    const planResult = await this.planExecutor.execute(executionPlan, config);
    await this.applyPlanExecutionResult(planResult, result, config, attempts, runDir, runId);
  }

  private async applyPlanExecutionResult(planResult: PlanExecutionResult, result: QaRunResult, config: RunConfig, attempts: AttemptRecord[], runDir: string, runId: string): Promise<void> {
    result.steps.push(...planResult.steps);
    attempts.push(...planResult.attempts);
    (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime = {
      ...(result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime,
      planVersion: planResult.finalPlan.version,
      patchCount: planResult.patchHistory.length,
      warnings: [
        ...(((result as QaRunResult & { planRuntime?: { fallbackReason?: unknown } }).planRuntime?.fallbackReason)
          ? [{ stepId: 'planner', message: this.plannerFallbackCode(String((result as QaRunResult & { planRuntime?: { fallbackReason?: unknown } }).planRuntime?.fallbackReason)) }]
          : []),
        ...planResult.warnings,
      ],
      evaluations: planResult.evaluations,
    };
    await this.repo.writeJson(runDir, 'execution-plan.json', this.sanitizer.sanitize(planResult.finalPlan));
    await this.repo.writeJson(runDir, 'patch-history.json', this.sanitizer.sanitize(planResult.patchHistory));

    for (const scenario of result.scenarios ?? []) {
      for (const task of scenario.tasks) {
        task.attempts = planResult.steps
          .filter((step) => step.taskId === task.id && step.resolvedAction)
          .map((step) => {
            const ok = Boolean(step.validation?.ok && !step.error);
            return { actionType: step.resolvedAction!.type, result: ok ? 'PASSED' : 'FAILED', reason: ok ? undefined : step.error?.message ?? step.validation?.actual, ts: step.finishedAt ?? new Date().toISOString() };
          });
        const requiredSteps = planResult.finalPlan.steps.filter((step) => step.taskId === task.id);
        const taskSteps = planResult.steps.filter((step) => step.taskId === task.id);
        const completed = requiredSteps.length > 0 && requiredSteps.every((required) => taskSteps.some((step) => step.stepId === required.id && step.validation?.ok && !step.error));
        const hasWarning = requiredSteps.some((required) => planResult.warnings.some((warning) => warning.stepId === required.id));
        task.status = completed ? (hasWarning ? 'PASSED_WITH_WARNINGS' : 'PASSED') : planResult.ok ? 'PASSED' : 'SKIPPED';
      }
    }

    if (!planResult.ok && planResult.failedStep && planResult.failedObservation) {
      const scenarioId = planResult.failedStep.scenarioId ?? result.scenarios?.[0]?.id ?? 'scenario-001';
      const taskId = planResult.failedStep.taskId ?? result.scenarios?.[0]?.tasks[0]?.id ?? 'T001';
      const task = result.scenarios?.flatMap((scenario) => scenario.tasks).find((item) => item.id === taskId);
      if (task) task.status = 'BLOCKED';
      result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, planResult.failedStep, planResult.failedObservation, planResult.failedMessage ?? 'plan execution failed', 'ASSERTION_FAILURE', config, scenarioId, taskId, attempts));
    }

    for (const scenario of result.scenarios ?? []) scenario.status = this.scenarioStatus(scenario);
  }

  private buildToolContext(input: { runId: string; config: RunConfig; runDir: string; scenarioId?: string }): QaToolContext {
    return {
      runId: input.runId,
      scenarioId: input.scenarioId,
      config: input.config,
      runDir: input.runDir,
      metadata: {
        executionPlanPlanner: this.executionPlanPlanner,
        planExecutor: this.planExecutor,
        planReplanner: { replan: () => { throw new Error('qa.plan.replan not available in this context'); } },
        evidence: this.evidence,
        memorySearch: this.memorySearch,
      },
    };
  }

  private async runWithTools(result: QaRunResult, config: RunConfig, dto: RunAgentDto, runDir: string, startedAt: Date, runId: string): Promise<QaRunResult> {
    void dto;
    const attempts: AttemptRecord[] = [];
    try {
      try {
        await this.browser.open(config);
      } catch (error) {
        if (error instanceof HarnessFatalError) throw error;
        throw new HarnessFatalError(error instanceof Error ? error.message : String(error), error);
      }

      const toolContext = this.buildToolContext({ runId, config, runDir });
      const usedTools: string[] = [];

      const buildOutput = await this.toolRegistry.execute('qa.plan.build', { config, scenarios: result.scenarios }, toolContext);
      usedTools.push('qa.plan.build');
      const buildResult = (buildOutput as { result?: { plan?: unknown; planSource?: unknown; fallbackReason?: unknown; fallbackWarning?: unknown; memoryContext?: { chunks?: unknown[] } } }).result;
      const executionPlan = buildResult?.plan as ExecutionPlan | undefined;
      if (!executionPlan) {
        throw new Error('qa.plan.build did not return a valid ExecutionPlan');
      }

      const memoryChunks = buildResult?.memoryContext?.chunks ?? [];
      result.memoryRuntime = {
        consulted: true,
        chunksReturned: memoryChunks.length,
        query: [config.demand.title, config.demand.description].filter(Boolean).join(' ').slice(0, 500),
        source: 'tool',
      };

      (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime = {
        ...(result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime,
        planSource: buildResult?.planSource,
        fallbackReason: buildResult?.fallbackReason,
        fallbackWarning: buildResult?.fallbackWarning,
      };

      const executeOutput = await this.toolRegistry.execute('qa.plan.execute', { plan: executionPlan, config, planRef: { runDir } }, toolContext);
      usedTools.push('qa.plan.execute');
      const executionResult = (executeOutput as { result?: { executionResult?: unknown } }).result?.executionResult as PlanExecutionResult | undefined;
      if (!executionResult) {
        throw new Error('qa.plan.execute did not return a valid execution result');
      }

      for (const scenario of result.scenarios ?? []) scenario.status = 'RUNNING';
      await this.applyPlanExecutionResult(executionResult, result, config, attempts, runDir, runId);

      result.toolRuntime = { enabled: true, usedTools };
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
    this.memory.ensure({ scenarioId: scenario.id, taskId: task.id, objective: task.title, expected: task.expected });
    const maxCycles = Math.max(config.runtime.maxActionsPerTask, config.recovery.maxAttemptsPerTask);
    for (let cycle = 0; cycle < maxCycles; cycle++) {
      let obs = await this.browser.observe();
      this.locators.rebuild(obs);
      this.memory.observe(scenario.id, task.id, obs);
      if (this.isTaskAlreadySatisfied(task, config, obs)) {
        const step = this.satisfiedStep(`S${String(result.steps.length + 1).padStart(4, '0')}`, scenario.id, task.id, obs.observationId, 'Task already satisfied by current authenticated page state');
        result.steps.push(step);
        task.status = 'PASSED';
        this.memory.done(scenario.id, task.id);
        return;
      }
      if (await this.trySemanticTheme(task, scenario, config, runDir, runId, result, attempts, obs)) return;
      if (await this.trySemanticLogout(task, scenario, config, runDir, runId, result, attempts, obs)) return;
      const decision = await this.decideWithSemanticRetry(task, scenario, config, obs, cycle);
      const { envelope, bound, action } = decision;
      const stepId = `S${String(result.steps.length + 1).padStart(4, '0')}`;
      const startedAtIso = new Date().toISOString();

      if (!decision.ok) {
        const blocked = this.blockedStep(stepId, scenario.id, task.id, envelope, bound, decision.code, decision.message, startedAtIso);
        result.steps.push(blocked);
        this.memory.block(scenario.id, task.id, decision.message);
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, blocked, obs, decision.message, 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts));
        task.status = 'BLOCKED';
        return;
      }
      const policy = this.actionPolicy.validate(action, config, attempts);
      if (!policy.ok) {
        const blocked = this.blockedStep(stepId, scenario.id, task.id, envelope, bound, policy.code, policy.message, startedAtIso);
        result.steps.push(blocked);
        this.memory.block(scenario.id, task.id, policy.message);
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, blocked, obs, policy.message, 'NAVIGATION_UNEXPECTED', config, scenario.id, task.id, attempts));
        task.status = 'BLOCKED';
        return;
      }

      const beforeActionObs = obs;
      const exec = await this.browser.execute(action);
      const taskAttempt: AttemptRecord = { actionType: action.type, result: exec.ok ? 'PASSED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() };
      attempts.push(taskAttempt);
      task.attempts.push(taskAttempt);
      this.memory.action(scenario.id, task.id, action, taskAttempt.result);

      const quiescence = await this.browser.waitForQuiescence(config.timeouts.quiescenceMs);
      if (!quiescence.stable) attempts.push({ actionType: 'waitForQuiescence', result: 'FAILED', reason: 'QUIESCENCE_TIMEOUT', ts: new Date().toISOString() });

      obs = await this.browser.observe();
      this.locators.rebuild(obs);
      this.memory.observe(scenario.id, task.id, obs);
      const changed = this.observationMeaningfullyChanged(beforeActionObs, obs);
      let expected: QaStep['boundExpected'];
      try {
        expected = this.data.resolveObject(bound, 'assertion');
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const blocked = { ...this.blockedStep(stepId, scenario.id, task.id, envelope, bound, error.code as NonNullable<QaStep['error']>['code'], error.message, startedAtIso), quiescence };
        result.steps.push(blocked);
        this.memory.block(scenario.id, task.id, error.message);
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
          beforeObservation: obs,
        });
        recoveryApplied = recovered.action;
        recoveredOk = recovered.ok;
        obs = await this.browser.observe();
        this.locators.rebuild(obs);
        this.memory.observe(scenario.id, task.id, obs);
        validation = await this.browser.validate(expected);
      }
      const ok = this.stepSucceeded(task, action, exec.ok, validation.ok, recoveredOk, expected, changed);
      const intermediateIntentStep = validation.ok && (this.isIntermediateLogoutMenuStep(task, action, expected) || this.isIntermediateThemeMenuStep(task, action, expected));

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
        error: ok || intermediateIntentStep ? undefined : { code: exec.error?.code ?? 'RECOVERY_EXHAUSTED', message: exec.error?.message ?? 'Recovery exhausted' },
      };
      result.steps.push(step);

      if (intermediateIntentStep) {
        if (await this.trySemanticLogout(task, scenario, config, runDir, runId, result, attempts, obs)) return;
        if (await this.trySemanticTheme(task, scenario, config, runDir, runId, result, attempts, obs)) return;
      }

      if (validation.type === 'no_console_errors' && !validation.ok) {
        task.status = 'BLOCKED';
        result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, step, obs, validation.actual || 'console errors detected', 'APP_CONSOLE_EXCEPTION', config, scenario.id, task.id, attempts, validation.expected, validation.actual));
        return;
      }

      if (ok) {
        task.status = 'PASSED';
        this.memory.done(scenario.id, task.id);
        return;
      }
      if (cycle === maxCycles - 1) {
        task.status = 'BLOCKED';
        this.memory.block(scenario.id, task.id, validation.actual || 'assertion failed');
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

  private async decideWithSemanticRetry(
    task: QaTask,
    scenario: QaScenario,
    config: RunConfig,
    obs: import('../../domain/schemas/observation.schema.js').ScreenObservation,
    cycle: number,
  ): Promise<{ ok: true; envelope: QaActionEnvelope; bound: QaStep['boundExpected']; action: QaStep['resolvedAction'] } | { ok: false; envelope: QaActionEnvelope; bound: QaStep['boundExpected']; action: QaStep['resolvedAction']; code: NonNullable<QaStep['error']>['code']; message: string }> {
    let issue: string | undefined;
    let last: { envelope: QaActionEnvelope; bound: QaStep['boundExpected']; action: QaStep['resolvedAction']; code: NonNullable<QaStep['error']>['code']; message: string } | undefined;
    const retries = Math.max(1, config.llm.maxSchemaRetries);

    for (let i = 0; i <= retries; i++) {
      const taskConfig = { ...config, demand: { ...config.demand, description: this.taskDecisionContext(task, scenario.id, cycle, issue) } };
      const envelope = await this.decision.decide({ config: taskConfig, observation: obs, runData: this.data.all() });
      let bound: QaStep['boundExpected'] = { type: 'no_console_errors' };
      let action: QaStep['resolvedAction'] = envelope.action;

      try {
        if (envelope.observationId !== obs.observationId) throw new DomainError('STALE_OBSERVATION', 'Envelope observationId is stale');
        bound = this.binder.bind(envelope.expected_after_action, obs);
        action = this.data.resolveObject(envelope.action, 'action');
        const promotedLogoutExpected = this.promoteLogoutMenuExpectation(task, action, bound, obs);
        if (promotedLogoutExpected) {
          bound = promotedLogoutExpected;
          this.memory.hypothesis(scenario.id, task.id, `Promoted weak logout validation to text_visible("${promotedLogoutExpected.text}") after menu-opening click.`);
        }
        const promotedThemeExpected = this.promoteThemeMenuExpectation(task, action, bound, obs);
        if (promotedThemeExpected) {
          bound = promotedThemeExpected;
          this.memory.hypothesis(scenario.id, task.id, `Promoted weak theme validation to text_visible("${promotedThemeExpected.text}") after menu-opening click.`);
        }
        const promotedMenuExpected = this.promoteMenuExpectation(task, action, bound, obs);
        if (promotedMenuExpected) {
          bound = promotedMenuExpected;
          this.memory.hypothesis(scenario.id, task.id, `Promoted weak menu validation to text_visible("${promotedMenuExpected.text}") after menu-opening click.`);
        }
        issue = this.semanticDecisionIssue(task, action, bound, obs);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        issue = error.message;
      }

      if (!issue) return { ok: true, envelope, bound, action };
      this.memory.hypothesis(scenario.id, task.id, issue);
      this.memory.reject(scenario.id, task.id, issue, this.intentRecommendation(task, obs));
      this.memory.action(scenario.id, task.id, action, `REJECTED: ${issue}`);
      last = { envelope, bound, action, code: issue === 'Envelope observationId is stale' ? 'STALE_OBSERVATION' : 'ACTION_SCHEMA_INVALID', message: issue };

      const corrected = this.intentAutocorrectEnvelope(task, obs, issue);
      if (corrected) {
        const correctedBound = this.binder.bind(corrected.expected_after_action, obs);
        const correctedAction = this.data.resolveObject(corrected.action, 'action');
        this.memory.hypothesis(scenario.id, task.id, `Autocorrected LLM decision after semantic rejection: ${issue}`);
        return { ok: true, envelope: corrected, bound: correctedBound, action: correctedAction };
      }
    }

    return { ok: false, ...last! };
  }

  private intentAutocorrectEnvelope(task: QaTask, obs: import('../../domain/schemas/observation.schema.js').ScreenObservation, issue: string): QaActionEnvelope | undefined {
    const target = this.intentTarget(task, obs);
    if (!target) return undefined;
    const expected = this.isLogoutTask(task)
      ? { type: 'text_visible' as const, text: this.isLogoutIntentTarget(target) ? 'Entrar' : 'Sair' }
      : { type: 'text_visible' as const, text: this.isThemeIntentTarget(target) ? this.themeExpectedAfterClick(target) : 'Tema' };
    return {
      schemaVersion: 'action.v1',
      observationId: obs.observationId,
      thought_summary: `Runtime autocorrected weak LLM decision: ${issue}`,
      action: { type: 'click', targetElementId: target.id, reason: `autocorrect ${task.title}` },
      expected_after_action: expected,
      fallback_action: { type: 'press', key: 'Escape', reason: 'close transient UI' },
      confidence: 0.7,
    };
  }

  private intentTarget(task: QaTask, obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): { id: string; name: string; text?: string } | undefined {
    if (this.isLogoutTask(task)) return obs.elements.find((e) => e.inViewport && (this.isLogoutIntentTarget(e) || this.isLogoutMenuElement(e)));
    if (this.isThemeTask(task)) return obs.elements.find((e) => e.inViewport && (this.isThemeIntentTarget(e) || this.isThemeMenuElement(e)));
    if (this.isMenuTask(task)) return obs.elements.find((e) => e.inViewport && this.isMenuTriggerElement(e));
    return undefined;
  }

  private intentRecommendation(task: QaTask, obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): string | undefined {
    const target = this.intentTarget(task, obs);
    if (!target) return undefined;
    if (this.isLogoutTask(task)) return this.isLogoutIntentTarget(target) ? `Click "${target.name}" and prove login screen` : `Open "${target.name}" and prove "Sair" is visible`;
    if (this.isThemeTask(task)) return this.isThemeIntentTarget(target) ? `Click "${target.name}" and prove theme toggled` : `Open "${target.name}" and prove theme option is visible`;
    if (this.isMenuTask(task)) return `Open "${target.name}" and prove a menu item is visible`;
    return undefined;
  }

  private isLogoutIntentTarget(element: { name: string; text?: string }): boolean {
    return /\b(sair|logout|sign out|encerrar sessão)\b/i.test(`${element.name} ${element.text ?? ''}`);
  }

  private isLogoutMenuElement(element: { name: string; text?: string }): boolean {
    return /\b(conta|opções|opcoes|settings|menu|perfil|profile|avatar|usu[aá]rio|user)\b/i.test(`${element.name} ${element.text ?? ''}`);
  }

  private isThemeIntentTarget(element: { name: string; text?: string }): boolean {
    return this.isThemeControlText(`${element.name} ${element.text ?? ''}`);
  }

  private isThemeMenuElement(element: { name: string; text?: string }): boolean {
    return this.isMenuTriggerText(`${element.name} ${element.text ?? ''}`);
  }

  private isMenuTriggerElement(element: { name: string; text?: string }): boolean {
    return this.isMenuTriggerText(`${element.name} ${element.text ?? ''}`);
  }

  private isMenuTriggerText(text: string): boolean {
    return /\b(conta|opções|opcoes|configurações|configuracoes|settings|menu|perfil|profile|avatar|apar[eê]ncia|appearance|usu[aá]rio|user)\b/i.test(text);
  }

  private themeExpectedAfterClick(element: { name: string; text?: string }): string {
    const text = `${element.name} ${element.text ?? ''}`;
    if (/tema escuro|dark/i.test(text)) return 'Tema claro';
    if (/tema claro|light/i.test(text)) return 'Tema escuro';
    return 'Tema';
  }

  private semanticDecisionIssue(task: QaTask, action: QaStep['resolvedAction'], expected: QaStep['boundExpected'], obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): string | undefined {
    if (this.isPreActionWeakExpected(task, action, expected)) return 'Weak validation: expected_after_action does not prove the requested state change';
    if (this.isIntermediateLogoutMenuStep(task, action, expected)) return undefined;
    if (this.isLogoutTask(task) && !this.isLogoutProof(expected)) return 'Logout action must prove a non-authenticated state, not only console or menu visibility';
    if (this.isThemeTask(task) && expected.type === 'no_console_errors' && !this.isThemeAction(action, obs)) {
      return 'Theme-change task cannot use no_console_errors before clicking an actual theme control; open the account/settings menu first and prove a visible theme option or toggled label';
    }
    if (expected.type === 'no_console_errors' && !this.isConsoleSafetyTask(task)) return 'Functional task cannot use no_console_errors as primary success proof';
    return undefined;
  }

  private taskDecisionContext(task: QaTask, scenarioId: string, cycle: number, semanticIssue?: string): string {
    const base = [
      `Task: ${task.title}`,
      `Expected result: ${task.expected}`,
      'Choose an action that directly advances this task.',
      'The expected_after_action must prove the task result, not merely that the clicked element remains visible.',
      'For functional tasks, no_console_errors is only a secondary safety check and is not enough to complete the task.',
      'For logout/sign-out tasks, prove logout with login screen text, login form visibility, or a URL that clearly moved to /login, /signin, or another non-authenticated route.',
    ];
    if (this.isThemeTask(task)) {
      base.push('For theme-change tasks, first open account/settings/theme menus if needed and prove the menu or theme option became visible.');
      base.push('Only click a real theme control such as Tema, Aparência, Escuro, Claro, Dark, Light, or Sistema; after that, prove the toggled option/label or another visible state change.');
    }
    const memory = this.memory.context(scenarioId, task.id);
    if (memory) base.push(memory);
    if (semanticIssue) base.push(`Last rejected LLM decision: ${semanticIssue}. Return a different action or stronger expected_after_action.`);
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
    if (this.isIntermediateLogoutMenuStep(task, action, expected)) return false;
    if (this.isIntermediateThemeMenuStep(task, action, expected)) return false;
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

  private observationMeaningfullyChanged(
    before: Pick<import('../../domain/schemas/observation.schema.js').ScreenObservation, 'url' | 'title' | 'visibleTexts' | 'elements' | 'pageState'>,
    after: Pick<import('../../domain/schemas/observation.schema.js').ScreenObservation, 'url' | 'title' | 'visibleTexts' | 'elements' | 'pageState'>,
  ): boolean {
    if (before.url !== after.url) return true;
    if (before.title !== after.title) return true;
    if (JSON.stringify(before.pageState) !== JSON.stringify(after.pageState)) return true;

    const beforeTexts = before.visibleTexts.slice(0, 12).join(' | ');
    const afterTexts = after.visibleTexts.slice(0, 12).join(' | ');
    if (beforeTexts !== afterTexts) return true;

    const signature = (obs: Pick<import('../../domain/schemas/observation.schema.js').ScreenObservation, 'elements'>) =>
      obs.elements
        .slice(0, 20)
        .map((e) => `${e.role}|${e.name}|${e.text ?? ''}|${e.checked ?? ''}|${e.selected ?? ''}|${e.expanded ?? ''}|${e.disabled ?? ''}|${e.inViewport}`)
        .join(' || ');

    return signature(before) !== signature(after);
  }

  private isConsoleSafetyTask(task: QaTask): boolean {
    const text = `${task.title} ${task.expected}`.toLowerCase();
    return /(console|erro crítico|critical error|javascript error|sem erro|no console)/i.test(text);
  }

  private isThemeTask(task: QaTask): boolean {
    const title = task.title.toLowerCase();
    const text = `${task.title} ${task.expected}`.toLowerCase();
    const menuPreparation =
      /\b(menu|conta|opções|opcoes|settings|configurações|configuracoes)\b/i.test(title) &&
      /\b(antes|before|visível|visivel|visible|verificar|check)\b/i.test(title);
    if (menuPreparation) return false;
    return /\b(tema|theme|apar[eê]ncia|appearance|modo escuro|dark mode|light mode|escuro|claro)\b/i.test(text);
  }

  private isMenuTask(task: QaTask): boolean {
    const text = `${task.title} ${task.expected}`.toLowerCase();
    return /\b(menu|painel|itens acion[aá]veis|account menu|settings menu|opções|opcoes)\b/i.test(text);
  }

  private isThemeAction(action: QaStep['resolvedAction'], obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): boolean {
    if (!('targetElementId' in action) || !action.targetElementId) return false;
    const target = obs.elements.find((e) => e.id === action.targetElementId);
    const text = `${target?.name ?? ''} ${target?.text ?? ''}`.toLowerCase();
    return /\b(tema|theme|apar[eê]ncia|appearance|dark|light|escuro|claro|system|sistema)\b/i.test(text);
  }

  private isIntermediateThemeMenuStep(task: QaTask, action: QaStep['resolvedAction'], expected: QaStep['boundExpected']): boolean {
    if (!this.isThemeTask(task)) return false;
    if (action.type !== 'click') return false;
    const reason = action.reason.toLowerCase();
    const looksLikeMenuOpen = /\b(open|abrir|menu|settings|configura[cç][õo]es|conta|perfil|options|opções|opcoes)\b/i.test(reason);
    if (!looksLikeMenuOpen) return false;
    if (expected.type === 'text_visible') return /\b(tema|theme|apar[eê]ncia|appearance)\b/i.test(expected.text);
    if (expected.type === 'element_visible' && expected.text) return /\b(tema|theme|apar[eê]ncia|appearance)\b/i.test(expected.text);
    return false;
  }

  private isThemeMenuAction(action: QaStep['resolvedAction'], obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): boolean {
    if (!('targetElementId' in action) || !action.targetElementId) return false;
    const target = obs.elements.find((e) => e.id === action.targetElementId);
    const text = `${target?.name ?? ''} ${target?.text ?? ''}`.toLowerCase();
    return this.isMenuTriggerText(text);
  }

  private isLogoutMenuAction(action: QaStep['resolvedAction'], obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): boolean {
    if (!('targetElementId' in action) || !action.targetElementId) return false;
    const target = obs.elements.find((e) => e.id === action.targetElementId);
    const text = `${target?.name ?? ''} ${target?.text ?? ''}`.toLowerCase();
    return this.isMenuTriggerText(text);
  }

  private isIntermediateLogoutMenuStep(task: QaTask, action: QaStep['resolvedAction'], expected: QaStep['boundExpected']): boolean {
    if (!this.isLogoutTask(task) || action.type !== 'click') return false;
    if (expected.type !== 'text_visible') return false;
    return /\b(sair|logout|sign out|encerrar sessão)\b/i.test(expected.text);
  }

  private promoteLogoutMenuExpectation(
    task: QaTask,
    action: QaStep['resolvedAction'],
    bound: QaStep['boundExpected'],
    obs: import('../../domain/schemas/observation.schema.js').ScreenObservation,
  ): Extract<QaStep['boundExpected'], { type: 'text_visible' }> | undefined {
    if (!this.isLogoutTask(task)) return undefined;
    if (bound.type !== 'no_console_errors') return undefined;
    if (!this.isLogoutMenuAction(action, obs)) return undefined;
    return { type: 'text_visible', text: 'Sair' };
  }

  private promoteMenuExpectation(
    task: QaTask,
    action: QaStep['resolvedAction'],
    bound: QaStep['boundExpected'],
    obs: import('../../domain/schemas/observation.schema.js').ScreenObservation,
  ): Extract<QaStep['boundExpected'], { type: 'text_visible' }> | undefined {
    if (!this.isMenuTask(task)) return undefined;
    if (bound.type !== 'no_console_errors') return undefined;
    if (!('targetElementId' in action) || !action.targetElementId) return undefined;
    const target = obs.elements.find((e) => e.id === action.targetElementId);
    if (!target || !this.isMenuTriggerElement(target)) return undefined;
    return { type: 'text_visible', text: this.menuProofText(task, target) };
  }

  private menuProofText(task: QaTask, target: { name: string; text?: string }): string {
    const text = `${task.title} ${task.expected} ${target.name} ${target.text ?? ''}`.toLowerCase();
    if (/\b(conta|account|perfil|profile|usu[aá]rio|user)\b/i.test(text)) return 'Sair';
    if (/\b(tema|theme|apar[eê]ncia|appearance)\b/i.test(text)) return 'Tema';
    return 'Configurações';
  }

  private async trySemanticTheme(task: QaTask, scenario: QaScenario, config: RunConfig, runDir: string, runId: string, result: QaRunResult, attempts: AttemptRecord[], obs: import('../../domain/schemas/observation.schema.js').ScreenObservation): Promise<boolean> {
    if (!this.isThemeTask(task)) return false;
    const target = obs.elements.find((e) => e.inViewport && this.isThemeControlText(`${e.name} ${e.text ?? ''}`));
    if (!target) return false;

    const stepId = `S${String(result.steps.length + 1).padStart(4, '0')}`;
    const startedAt = new Date().toISOString();
    const action = { type: 'click' as const, targetElementId: target.id, reason: `semantic theme toggle via "${target.name}"` };
    const exec = await this.browser.execute(action);
    const attempt: AttemptRecord = { actionType: action.type, result: exec.ok ? 'PASSED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() };
    attempts.push(attempt);
    task.attempts?.push(attempt);
    this.memory.action(scenario.id, task.id, action, attempt.result);

    const quiescence = await this.browser.waitForQuiescence(config.timeouts.quiescenceMs);
    const after = await this.browser.observe();
    this.locators.rebuild(after);
    this.memory.observe(scenario.id, task.id, after);
    const validation = this.themeObservationValidation(obs, after, target.name);
    const step: QaStep = {
      stepId,
      scenarioId: scenario.id,
      taskId: task.id,
      observationId: after.observationId,
      thoughtSummary: `Semantic theme control clicked visible item "${target.name}".`,
      confidence: 1,
      action,
      resolvedAction: action,
      boundExpected: validation.boundExpected,
      validation: validation.result,
      quiescence,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: exec.ok && validation.result.ok ? undefined : { code: exec.error?.code ?? 'ASSERTION_FAILED', message: exec.error?.message ?? 'Theme change was not proven' },
    };
    result.steps.push(step);
    if (exec.ok && validation.result.ok) {
      task.status = 'PASSED';
      this.memory.done(scenario.id, task.id);
      return true;
    }
    if ((task.attempts?.length ?? 0) >= Math.max(config.runtime.maxActionsPerTask, config.recovery.maxAttemptsPerTask)) {
      task.status = 'BLOCKED';
      this.memory.block(scenario.id, task.id, validation.result.actual || 'theme change was not proven');
      result.bugs!.push(await this.recordBug(runDir, runId, result.bugs!.length + 1, step, after, validation.result.actual || 'theme change was not proven', 'ASSERTION_FAILURE', config, scenario.id, task.id, attempts, validation.result.expected, validation.result.actual));
      return true;
    }
    return false;
  }

  private themeObservationValidation(before: import('../../domain/schemas/observation.schema.js').ScreenObservation, after: import('../../domain/schemas/observation.schema.js').ScreenObservation, label: string): { boundExpected: QaStep['boundExpected']; result: NonNullable<QaStep['validation']> } {
    const text = [...after.visibleTexts, ...after.elements.flatMap((e) => [e.name, e.text ?? ''])].join(' | ');
    const toggledLabel = /tema escuro|dark/i.test(label) ? /tema claro|light/i.test(text) : /tema escuro|dark/i.test(text);
    const changed = this.observationMeaningfullyChanged(before, after);
    const ok = toggledLabel || changed;
    return {
      boundExpected: { type: 'text_visible', text: toggledLabel ? (/tema escuro|dark/i.test(label) ? 'Tema claro' : 'Tema escuro') : label },
      result: { ok, type: 'theme_state', expected: 'theme control toggled or visible UI state changed', actual: ok ? after.url : `${after.url} :: ${after.visibleTexts.slice(0, 5).join(' | ')}`, durationMs: 0 },
    };
  }

  private isThemeControlText(text: string): boolean {
    return /\b(tema\s+(escuro|claro)|dark\s+theme|light\s+theme|modo\s+(escuro|claro)|dark mode|light mode)\b/i.test(text);
  }

  private promoteThemeMenuExpectation(
    task: QaTask,
    action: QaStep['resolvedAction'],
    bound: QaStep['boundExpected'],
    obs: import('../../domain/schemas/observation.schema.js').ScreenObservation,
  ): Extract<QaStep['boundExpected'], { type: 'text_visible' }> | undefined {
    if (!this.isThemeTask(task)) return undefined;
    if (bound.type !== 'no_console_errors') return undefined;
    if (!this.isThemeMenuAction(action, obs)) return undefined;
    return { type: 'text_visible', text: this.themeProofText(task) };
  }

  private themeProofText(task: QaTask): string {
    const text = `${task.title} ${task.expected}`.toLowerCase();
    if (/(apar[eê]ncia|appearance)/i.test(text)) return 'Aparência';
    if (/\b(dark|escuro)\b/i.test(text)) return 'Escuro';
    if (/\b(light|claro)\b/i.test(text)) return 'Claro';
    return 'Tema';
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
      this.memory.done(scenario.id, task.id);
      return true;
    }
    if ((task.attempts?.length ?? 0) >= Math.max(config.runtime.maxActionsPerTask, config.recovery.maxAttemptsPerTask)) {
      task.status = 'BLOCKED';
      this.memory.block(scenario.id, task.id, validation.result.actual || 'logout was not proven');
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
    const llmStats = this.decision.stats?.();
    if (llmStats?.breakdown) {
      console.log(`[LLM Stats] total=${llmStats.calls}, breakdown=${JSON.stringify(llmStats.breakdown)}`);
    }
    const compactPlanRuntime = this.compactPlanRuntime((result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime);
    (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime = compactPlanRuntime;
    if (capturePassArtifacts && result.status === 'PASSED') {
      if (config.output.keepTraceOnPass) await this.browser.saveTrace(`${result.runDir}/artifacts/traces/run-trace.zip`).catch(() => undefined);
      if (config.output.keepVideoOnPass) await this.browser.saveVideo(`${result.runDir}/artifacts/videos/run-video.webm`).catch(() => undefined);
      if (config.output.keepScreenshotOnPass) {
        const screenshot = await this.browser.screenshot().catch(() => undefined);
        if (screenshot) await this.repo.writeFile(result.runDir, 'artifacts/screenshots/final.png', screenshot);
      }
    }
    for (const scenario of result.scenarios ?? []) {
      await this.repo.writeJson(result.runDir, `scenarios/${scenario.id}/status.json`, this.sanitizer.sanitize({ id: scenario.id, status: scenario.status, tasks: scenario.tasks }));
      await this.repo.writeFile(result.runDir, `scenarios/${scenario.id}/scenario-report.md`, `# ${scenario.title}\n\nStatus: ${scenario.status}\n\nTasks: ${scenario.tasks.map((task) => `${task.id}=${task.status}`).join(', ')}\n`);
    }
    await this.repo.writeJson(result.runDir, 'config.json', this.sanitizer.sanitize(config));
    await this.repo.writeJson(result.runDir, 'run-data.json', this.sanitizer.sanitize(this.data.all()));
    await this.repo.writeJson(result.runDir, 'task-memory.json', this.sanitizer.sanitize(this.memory.all()));
    await this.repo.writeJson(result.runDir, 'execution-log.json', this.sanitizer.sanitize({ version: 'log.v1', runId, planRuntime: compactPlanRuntime, toolRuntime: result.toolRuntime ?? { enabled: false, usedTools: [] }, memoryRuntime: result.memoryRuntime, llmStats: this.decision.stats?.(), attempts, steps: result.steps, bugs: result.bugs }));
    await this.repo.writeJson(result.runDir, 'metrics.json', result.metrics);
    await this.repo.writeJson(result.runDir, 'qa-summary.json', this.sanitizer.sanitize({ runId, status: result.status, metrics: result.metrics, bugs: result.bugs, scenarios: result.scenarios, planRuntime: compactPlanRuntime, toolRuntime: result.toolRuntime ?? { enabled: false, usedTools: [] }, memoryRuntime: result.memoryRuntime }));
    await this.repo.writeFile(result.runDir, 'generated-test.spec.ts', this.specExporter.export(result));
    await this.repo.writeJson(result.runDir, 'run.json', this.sanitizer.sanitize({ schemaVersion: 'run.v1', runId, ...result }));
    await this.repo.writeReport(result.runDir, result, config, runId);
    return result;
  }

  private compactPlanRuntime(planRuntime?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!planRuntime) return undefined;
    const evaluations = Array.isArray(planRuntime.evaluations) ? planRuntime.evaluations : [];
    const compactEvaluations = evaluations.map((evaluation) => this.compactEvaluation(evaluation)) as Array<Record<string, unknown>>;
    const failedEvaluations = compactEvaluations.filter((evaluation) => evaluation.passed === false);
    return {
      plannerProvider: planRuntime.plannerProvider,
      plannerModel: planRuntime.plannerModel,
      planSource: planRuntime.planSource,
      planVersion: planRuntime.planVersion,
      fallbackReason: this.compactString(planRuntime.fallbackReason, 500),
      fallbackWarning: planRuntime.fallbackWarning,
      patchCount: planRuntime.patchCount,
      warnings: planRuntime.warnings,
      evaluationCount: evaluations.length,
      failedEvaluationCount: failedEvaluations.length,
      evaluationsByPhase: this.evaluationsByPhase(evaluations),
      failedEvaluations,
    };
  }

  private evaluationsByPhase(evaluations: unknown[]): Record<string, { total: number; passed: number; failed: number }> {
    const summary: Record<string, { total: number; passed: number; failed: number }> = {};
    for (const evaluation of evaluations) {
      const item = evaluation && typeof evaluation === 'object' ? evaluation as Record<string, unknown> : {};
      const phase = String(item.phase ?? 'unknown');
      summary[phase] ??= { total: 0, passed: 0, failed: 0 };
      summary[phase].total += 1;
      if (item.passed === false) summary[phase].failed += 1;
      else summary[phase].passed += 1;
    }
    return summary;
  }

  private compactEvaluation(evaluation: unknown): unknown {
    if (!evaluation || typeof evaluation !== 'object') return evaluation;
    const item = evaluation as Record<string, unknown>;
    return {
      conditionId: item.conditionId,
      stepId: item.stepId,
      phase: item.phase,
      type: item.type,
      passed: item.passed,
      expected: this.compactValue(item.expected, 240),
      actual: this.compactValue(item.actual, 240),
      before: this.compactSnapshot(item.before),
      after: this.compactSnapshot(item.after),
      severity: item.severity,
      reason: item.reason,
    };
  }

  private compactSnapshot(snapshot: unknown): unknown {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const item = snapshot as Record<string, unknown>;
    const semanticStates = item.semanticStates && typeof item.semanticStates === 'object' ? item.semanticStates as Record<string, unknown> : {};
    return {
      observationId: item.observationId,
      url: item.url,
      auth: semanticStates.auth,
      menuOpen: semanticStates.menuOpen,
      appearanceMode: this.compactString(semanticStates.appearance_mode, 220),
      visibleTextSample: this.compactString(semanticStates.visibleTextSignature, 260),
      timestamp: item.timestamp,
    };
  }

  private compactValue(value: unknown, maxLength: number): unknown {
    if (typeof value === 'string') return this.compactString(value, maxLength);
    if (Array.isArray(value)) return value.slice(0, 8).map((item) => this.compactValue(item, maxLength));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 12).map(([key, item]) => [key, this.compactValue(item, maxLength)]));
    }
    return value;
  }

  private compactString(value: unknown, maxLength: number): unknown {
    if (typeof value !== 'string') return value;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}... [truncated ${normalized.length - maxLength} chars]` : normalized;
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
    if (scenario.tasks.every((t) => t.status === 'PASSED' || t.status === 'PASSED_WITH_WARNINGS') && scenario.tasks.some((t) => t.status === 'PASSED_WITH_WARNINGS')) return 'PASSED_WITH_WARNINGS';
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
    if ((result.scenarios ?? []).some((s) => s.status === 'PASSED_WITH_WARNINGS')) return 'PASSED_WITH_WARNINGS';
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
