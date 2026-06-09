import { RunConfigSchema, type RunConfig } from '../../domain/schemas/config.schema.js';
import { RunAgentDtoSchema, type RunAgentDto } from '../dto/run-agent.dto.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { ZodError } from 'zod';

import type { AttemptRecord, BugSignalType, QaBug, QaRunMetrics, QaRunResult, QaScenario, QaStep } from '../../domain/models/run.model.js';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import { ConfigError, HarnessFatalError, RunTimeoutError } from '../../domain/errors.js';
import { DataHarnessService } from '../services/data-harness.service.js';
import { SanitizerService } from '../services/sanitizer.service.js';
import { BugClassifierService } from '../services/bug-classifier.service.js';
import { EvidenceService } from '../services/evidence.service.js';
import { ScenarioPlannerService } from '../services/scenario-planner.service.js';
import { TaskMemoryService } from '../services/task-memory.service.js';
import { ValidateConfigUseCase } from './validate-config.usecase.js';
import { ExecutionPlanPlannerService, type ExecutionPlanSource } from '../services/execution-plan-planner.service.js';
import { PlanExecutorService, type PlanExecutionResult } from '../services/plan-executor.service.js';
import { ReactiveRunnerService } from '../services/reactive-runner.service.js';
import { PlaywrightSpecExporter } from '../services/playwright-spec-exporter.service.js';
import type { ExecutionPlan } from '../../domain/schemas/execution-plan.schema.js';
import { QaToolRegistry } from '../tools/qa-tool-registry.js';
import type { QaToolContext } from '../tools/qa-tool-context.js';
import { MemorySearchService } from '../services/memory-search.service.js';
import { DemandContextPersistenceService } from '../services/demand-context-persistence.service.js';
import { PRReporterService } from '../services/pr-reporter.service.js';
import { collectKnownSecretsFromEnv } from '../services/known-secrets.collector.js';
import { redactSecretsInMessage } from '../helpers/sanitize-token.js';

const logger = new Logger('RunAgentUseCase');

@Injectable()
export class RunAgentUseCase {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
    @Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort,
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
    @Inject(DataHarnessService) private readonly data: DataHarnessService,
    @Inject(SanitizerService) private readonly sanitizer: SanitizerService,
    @Inject(BugClassifierService) private readonly bugClassifier: BugClassifierService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(ScenarioPlannerService) private readonly planner: ScenarioPlannerService,
    @Inject(TaskMemoryService) private readonly memory: TaskMemoryService,
    @Inject(ValidateConfigUseCase) private readonly validateConfig: ValidateConfigUseCase,
    @Inject(ExecutionPlanPlannerService) private readonly executionPlanPlanner: ExecutionPlanPlannerService,
    @Inject(PlanExecutorService) private readonly planExecutor: PlanExecutorService,
    @Inject(ReactiveRunnerService) private readonly reactiveRunner: ReactiveRunnerService,
    @Inject(PlaywrightSpecExporter) private readonly specExporter: PlaywrightSpecExporter,
    @Inject(MemorySearchService) private readonly memorySearch: MemorySearchService,
    @Inject(QaToolRegistry) private readonly toolRegistry: QaToolRegistry,
    @Inject(DemandContextPersistenceService)
    private readonly demandContextPersistence: DemandContextPersistenceService,
    @Inject(PRReporterService) private readonly prReporter: PRReporterService,
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
    try {
      await this.persistClickUpDemandContext(runDir, config);
    } catch (error) {
      logger.warn(
        `ClickUp demand context persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      // fallback: execução sem contexto ClickUp
    }

    const scenarios = await this.planner.plan(config);
    const filtered = dto.scenarioId ? scenarios.filter((s) => s.id === dto.scenarioId) : scenarios.slice(0, dto.maxScenarios ?? scenarios.length);
    // Execution routes (config -> route):
    //   1. tools.enabled=true & mode!=FULL_REACTIVE -> Tools route (runWithTools) -> PlanExecutorService
    //   2. tools.enabled=false & mode!=FULL_REACTIVE -> Plan route (runWithBrowser+plan) -> PlanExecutorService
    //   3. mode=FULL_REACTIVE -> Reactive route (runScenario/runTask) -> decideWithSemanticRetry (opt-in/experimental)
    // Routes 1 and 2 converge on PlanExecutorService and share the same fallback ladder
    // (locator -> ensureAvailable -> decide() -> replan()). Route 3 is a distinct
    // fully-reactive paradigm driven by decide() per action; keep it explicit/opt-in.
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

  private async persistClickUpDemandContext(runDir: string, config: RunConfig): Promise<void> {
    const token = process.env.CLICKUP_TOKEN?.trim();
    if (!token) return;

    const configTaskId = config.clickup?.taskId?.trim();
    const envTaskId = process.env.CLICKUP_TASK_ID?.trim();
    const hasTaskId = Boolean(configTaskId || envTaskId);
    if (!hasTaskId) return;

    if (!configTaskId && envTaskId) {
      logger.warn('CLICKUP_TASK_ID env is deprecated; use config.clickup.taskId instead.');
    }

    await this.demandContextPersistence.persistFromClickUpTask(runDir, token, {
      configTaskId: configTaskId ?? envTaskId,
      configTeamId: config.clickup?.teamId,
    });
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
        await this.reactiveRunner.runScenario(scenario, config, runDir, runId, result, attempts);
        scenario.status = this.scenarioStatus(scenario);
        if (this.hasBlockingBug(result) || scenario.status === 'BLOCKED') break;
      }

      result.status = this.runStatus(result);
      return await this.finalize(result, config, attempts, startedAt, runId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Run crashed: ${message}`, error instanceof Error ? error.stack : undefined);
      result.status = 'BLOCKED';
      result.bugs!.push({
        bugId: `BUG-CRASH-${runId}`,
        stepId: 'crash',
        scenarioId: result.scenarios?.[0]?.id,
        taskId: result.scenarios?.[0]?.tasks[0]?.id,
        classification: { isBug: true, severity: 'CRITICAL', category: 'APP_FAULT', reason: 'Unhandled runtime error during test execution' },
        path: runDir,
        url: undefined,
        expected: 'Run completes without crash',
        actual: message,
        signalType: 'ASSERTION_FAILURE',
        rawMessage: error instanceof Error ? error.stack : message,
        capturedAt: new Date().toISOString(),
      });
      await this.finalize(result, config, attempts, startedAt, runId, false);
      return result;
    } finally {
      try {
        await this.browser.close();
      } catch (closeErr) {
        const msg = closeErr instanceof Error ? closeErr.message : String(closeErr);
        logger.error(`Browser close failed in finally: ${msg}`);
      }
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Run crashed: ${message}`, error instanceof Error ? error.stack : undefined);
      result.status = 'BLOCKED';
      result.bugs!.push({
        bugId: `BUG-CRASH-${runId}`,
        stepId: 'crash',
        scenarioId: result.scenarios?.[0]?.id,
        taskId: result.scenarios?.[0]?.tasks[0]?.id,
        classification: { isBug: true, severity: 'CRITICAL', category: 'APP_FAULT', reason: 'Unhandled runtime error during test execution' },
        path: runDir,
        url: undefined,
        expected: 'Run completes without crash',
        actual: message,
        signalType: 'ASSERTION_FAILURE',
        rawMessage: error instanceof Error ? error.stack : message,
        capturedAt: new Date().toISOString(),
      });
      await this.finalize(result, config, attempts, startedAt, runId, false);
      return result;
    } finally {
      logger.warn('Closing browser...');
      try {
        await this.browser.close();
        logger.warn('Browser closed successfully');
      } catch (closeErr) {
        const msg = closeErr instanceof Error ? closeErr.message : String(closeErr);
        logger.error(`Browser close failed in finally: ${msg}`);
      }
    }
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

  private async finalize(result: QaRunResult, config: RunConfig, attempts: AttemptRecord[], startedAt: Date, runId: string, capturePassArtifacts: boolean): Promise<QaRunResult> {
    result.metrics = this.metrics(result, startedAt);
    result.finishedAt = new Date().toISOString();
    const llmStats = this.decision.stats?.();
    if (llmStats?.breakdown) {
      console.log(`[LLM Stats] total=${llmStats.calls}, breakdown=${JSON.stringify(llmStats.breakdown)}`);
    }
    let compactPlanRuntime = this.compactPlanRuntime((result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime);
    (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime = compactPlanRuntime;

    if (config.pr) {
      try {
        const prReportResult = await this.prReporter.report({
          result,
          config,
          runDir: result.runDir,
          repository: config.pr.repository,
          pullNumber: config.pr.pullNumber,
          token: config.pr.token,
          commitSha: config.pr.commitSha,
          headRef: config.pr.headRef,
          baseRef: config.pr.baseRef,
        });
        if (prReportResult.publicationWarning) {
          const planRuntime = (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime ?? {};
          const existingWarnings = Array.isArray(planRuntime.warnings) ? planRuntime.warnings : [];
          // planRuntime is already compacted here; append the warning in place to avoid
          // re-compacting (which would drop evaluation counts/phases already summarized).
          compactPlanRuntime = {
            ...planRuntime,
            warnings: [
              ...existingWarnings,
              { stepId: 'pr-reporter', message: prReportResult.publicationWarning },
            ],
          };
          (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime = compactPlanRuntime;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const secrets = collectKnownSecretsFromEnv(process.env, config.pr.token ? [config.pr.token] : []);
        logger.warn(`PR report generation skipped: ${redactSecretsInMessage(message, secrets)}`);
      }
    }

    const hasFailure = result.status !== 'PASSED';
    const shouldSaveVideo = config.evidence.video === 'on' || (hasFailure && config.evidence.video === 'on-failure');
    const shouldSaveTrace = config.evidence.trace === 'on' || (hasFailure && config.evidence.trace === 'on-failure');

    if (shouldSaveVideo) {
      await this.browser.saveVideo(`${result.runDir}/artifacts/videos/run-video.webm`).catch(() => undefined);
    }
    if (shouldSaveTrace) {
      await this.browser.saveTrace(`${result.runDir}/artifacts/traces/run-trace.zip`).catch(() => undefined);
    }
    if (capturePassArtifacts && result.status === 'PASSED') {
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
