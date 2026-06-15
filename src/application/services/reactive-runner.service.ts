import { Inject, Injectable } from '@nestjs/common';

import type { AttemptRecord, BugSignalType, QaBug, QaRunResult, QaScenario, QaStep, QaTask } from '../../domain/models/run.model.js';
import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import { DomainError } from '../../domain/shared/result.js';
import { ActionPolicyService } from './action-policy.service.js';
import { BugClassifierService } from './bug-classifier.service.js';
import { DataHarnessService } from './data-harness.service.js';
import { EvidenceService } from './evidence.service.js';
import { LocatorResolverService } from './locator-resolver.service.js';
import { RecoveryPolicyService } from './recovery-policy.service.js';
import { TaskMemoryService } from './task-memory.service.js';
import { ValidationBinderService } from './validation-binder.service.js';

/**
 * ReactiveRunnerService encapsulates the fully-reactive execution paradigm
 * (mode=FULL_REACTIVE): drive one decide() per action and apply semantic
 * intent heuristics for theme/logout/menu outcomes. Isolated from
 * RunAgentUseCase so the Tools/Plan routes stay lean while the reactive
 * intelligence remains available and reusable.
 */
@Injectable()
export class ReactiveRunnerService {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
    @Inject(DataHarnessService) private readonly data: DataHarnessService,
    @Inject(LocatorResolverService) private readonly locators: LocatorResolverService,
    @Inject(ValidationBinderService) private readonly binder: ValidationBinderService,
    @Inject(ActionPolicyService) private readonly actionPolicy: ActionPolicyService,
    @Inject(RecoveryPolicyService) private readonly recovery: RecoveryPolicyService,
    @Inject(TaskMemoryService) private readonly memory: TaskMemoryService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(BugClassifierService) private readonly bugClassifier: BugClassifierService,
  ) {}

  async runScenario(scenario: QaScenario, config: RunConfig, runDir: string, runId: string, result: QaRunResult, attempts: AttemptRecord[]): Promise<void> {
    const startObs = await this.browser.observe().catch(() => undefined);
    await this.evidence.recordScenarioScreenshot(runDir, scenario.id, 'start', startObs ? { observation: startObs } : undefined);

    for (const task of scenario.tasks) {
      if (task.status !== 'PENDING') continue;
      if (this.depsBlocked(task, scenario.tasks)) {
        task.status = 'SKIPPED';
        attempts.push({ actionType: 'task-skip', result: 'BLOCKED', reason: `dependency blocked: ${task.dependsOn?.join(', ')}`, ts: new Date().toISOString() });
        continue;
      }
      await this.runTask(task, scenario, config, runDir, runId, result, attempts);
    }

    const endObs = await this.browser.observe().catch(() => undefined);
    await this.evidence.recordScenarioScreenshot(runDir, scenario.id, 'end', endObs ? { observation: endObs } : undefined);
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

  private async recordBug(runDir: string, runId: string, index: number, step: QaStep, observation: ScreenObservation | undefined, message: string, signalType: BugSignalType, config: RunConfig, scenarioId: string, taskId: string, attempts: AttemptRecord[], expected?: string, actual?: string): Promise<QaBug> {
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
    obs: ScreenObservation,
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

  private intentAutocorrectEnvelope(task: QaTask, obs: ScreenObservation, issue: string): QaActionEnvelope | undefined {
    const target = this.intentTarget(task, obs);
    if (!target) return undefined;
    const expected = this.autocorrectExpected(task, target);
    if (!expected) return undefined;
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

  private intentTarget(task: QaTask, obs: ScreenObservation): { id: string; name: string; text?: string } | undefined {
    if (!this.isLogoutTask(task) && !this.isThemeTask(task) && !this.isMenuTask(task)) return undefined;
    return this.findElementByOutcomeTarget(task, obs);
  }

  private intentRecommendation(task: QaTask, obs: ScreenObservation): string | undefined {
    const target = this.intentTarget(task, obs);
    if (!target) return undefined;
    return `Use "${target.name}" and prove the expected state with a stronger validation`;
  }

  private autocorrectExpected(task: QaTask, target: { name: string; text?: string }): Extract<QaActionEnvelope['expected_after_action'], { type: 'text_visible' }> | undefined {
    if (this.isLogoutTask(task)) return { type: 'text_visible', text: this.primaryOutcomeTarget(task) ?? target.name };
    if (this.isThemeTask(task) || this.isMenuTask(task)) return { type: 'text_visible', text: this.primaryOutcomeTarget(task) ?? target.name };
    return undefined;
  }

  private findElementByOutcomeTarget(task: QaTask, obs: ScreenObservation): { id: string; name: string; text?: string } | undefined {
    const candidates = this.outcomeTargetCandidates(task);
    if (!candidates.length) return undefined;
    return obs.elements.find((element) => element.inViewport && this.matchesAnyCandidate(`${element.name} ${element.text ?? ''}`, candidates));
  }

  private outcomeTargetCandidates(task: QaTask): string[] {
    const raw = task.expectedOutcome?.target ?? '';
    return raw.split('|').map((candidate) => candidate.trim()).filter(Boolean);
  }

  private primaryOutcomeTarget(task: QaTask): string | undefined {
    return this.outcomeTargetCandidates(task)[0];
  }

  private matchesAnyCandidate(text: string, candidates: string[]): boolean {
    const normalizedText = this.normalizeSemanticText(text);
    return candidates.some((candidate) => {
      const normalizedCandidate = this.normalizeSemanticText(candidate);
      return normalizedCandidate.length > 0 && normalizedText.includes(normalizedCandidate);
    });
  }

  private normalizeSemanticText(value: string): string {
    return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  }

  private semanticDecisionIssue(task: QaTask, action: QaStep['resolvedAction'], expected: QaStep['boundExpected'], obs: ScreenObservation): string | undefined {
    if (this.isPreActionWeakExpected(task, action, expected)) return 'Weak validation: expected_after_action does not prove the requested state change';
    if (this.isIntermediateLogoutMenuStep(task, action, expected)) return undefined;
    if (this.isLogoutTask(task) && !this.isLogoutProof(expected)) return 'Logout action must prove a non-authenticated state, not only console or menu visibility';
    if (this.isThemeTask(task) && expected.type === 'no_console_errors' && !this.isOutcomeTargetAction(task, action, obs)) {
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
      'For deauthentication tasks, prove a non-authenticated state with login screen visibility or a non-authenticated route.',
    ];
    if (this.isThemeTask(task)) {
      base.push('For appearance-change tasks, click a real control from the expected outcome target/candidates and prove a visible state change.');
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
    before: Pick<ScreenObservation, 'url' | 'title' | 'visibleTexts' | 'elements' | 'pageState'>,
    after: Pick<ScreenObservation, 'url' | 'title' | 'visibleTexts' | 'elements' | 'pageState'>,
  ): boolean {
    if (before.url !== after.url) return true;
    if (before.title !== after.title) return true;
    if (JSON.stringify(before.pageState) !== JSON.stringify(after.pageState)) return true;

    const beforeTexts = before.visibleTexts.slice(0, 12).join(' | ');
    const afterTexts = after.visibleTexts.slice(0, 12).join(' | ');
    if (beforeTexts !== afterTexts) return true;

    const signature = (obs: Pick<ScreenObservation, 'elements'>) =>
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
    return task.expectedOutcome?.kind === 'APPEARANCE_CHANGE';
  }

  private isMenuTask(task: QaTask): boolean {
    return task.expectedOutcome?.kind === 'DISCLOSURE';
  }

  private isOutcomeTargetAction(task: QaTask, action: QaStep['resolvedAction'], obs: ScreenObservation): boolean {
    if (!('targetElementId' in action) || !action.targetElementId) return false;
    const target = obs.elements.find((e) => e.id === action.targetElementId);
    if (!target) return false;
    return this.matchesAnyCandidate(`${target.name} ${target.text ?? ''}`, this.outcomeTargetCandidates(task));
  }

  private isIntermediateThemeMenuStep(task: QaTask, action: QaStep['resolvedAction'], expected: QaStep['boundExpected']): boolean {
    if (!this.isThemeTask(task)) return false;
    if (action.type !== 'click') return false;
    const candidates = this.outcomeTargetCandidates(task);
    if (!candidates.length) return false;
    if (expected.type === 'text_visible') return this.matchesAnyCandidate(expected.text, candidates);
    if (expected.type === 'element_visible' && expected.text) return this.matchesAnyCandidate(expected.text, candidates);
    return false;
  }

  private isOutcomeMenuAction(task: QaTask, action: QaStep['resolvedAction'], obs: ScreenObservation): boolean {
    if (!('targetElementId' in action) || !action.targetElementId) return false;
    const target = obs.elements.find((e) => e.id === action.targetElementId);
    if (!target) return false;
    return this.matchesAnyCandidate(`${target.name} ${target.text ?? ''}`, this.outcomeTargetCandidates(task));
  }

  private isIntermediateLogoutMenuStep(task: QaTask, action: QaStep['resolvedAction'], expected: QaStep['boundExpected']): boolean {
    if (!this.isLogoutTask(task) || action.type !== 'click') return false;
    if (expected.type !== 'text_visible') return false;
    return this.matchesAnyCandidate(expected.text, this.outcomeTargetCandidates(task));
  }

  private promoteLogoutMenuExpectation(
    task: QaTask,
    action: QaStep['resolvedAction'],
    bound: QaStep['boundExpected'],
    obs: ScreenObservation,
  ): Extract<QaStep['boundExpected'], { type: 'text_visible' }> | undefined {
    if (!this.isLogoutTask(task)) return undefined;
    if (bound.type !== 'no_console_errors') return undefined;
    if (!this.isOutcomeMenuAction(task, action, obs)) return undefined;
    const proof = this.primaryOutcomeTarget(task);
    return proof ? { type: 'text_visible', text: proof } : undefined;
  }

  private promoteMenuExpectation(
    task: QaTask,
    action: QaStep['resolvedAction'],
    bound: QaStep['boundExpected'],
    obs: ScreenObservation,
  ): Extract<QaStep['boundExpected'], { type: 'text_visible' }> | undefined {
    if (!this.isMenuTask(task)) return undefined;
    if (bound.type !== 'no_console_errors') return undefined;
    if (!('targetElementId' in action) || !action.targetElementId) return undefined;
    const target = obs.elements.find((e) => e.id === action.targetElementId);
    if (!target || !this.matchesAnyCandidate(`${target.name} ${target.text ?? ''}`, this.outcomeTargetCandidates(task))) return undefined;
    const proof = this.primaryOutcomeTarget(task);
    return proof ? { type: 'text_visible', text: proof } : undefined;
  }

  private async trySemanticTheme(task: QaTask, scenario: QaScenario, config: RunConfig, runDir: string, runId: string, result: QaRunResult, attempts: AttemptRecord[], obs: ScreenObservation): Promise<boolean> {
    if (!this.isThemeTask(task)) return false;
    const candidates = this.outcomeTargetCandidates(task);
    const target = obs.elements.find((e) => e.inViewport && this.matchesAnyCandidate(`${e.name} ${e.text ?? ''}`, candidates));
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

  private themeObservationValidation(before: ScreenObservation, after: ScreenObservation, label: string): { boundExpected: QaStep['boundExpected']; result: NonNullable<QaStep['validation']> } {
    const changed = this.observationMeaningfullyChanged(before, after);
    return {
      boundExpected: { type: 'text_visible', text: label },
      result: { ok: changed, type: 'appearance_state', expected: 'visible UI state changed', actual: changed ? after.url : `${after.url} :: ${after.visibleTexts.slice(0, 5).join(' | ')}`, durationMs: 0 },
    };
  }

  private promoteThemeMenuExpectation(
    task: QaTask,
    action: QaStep['resolvedAction'],
    bound: QaStep['boundExpected'],
    obs: ScreenObservation,
  ): Extract<QaStep['boundExpected'], { type: 'text_visible' }> | undefined {
    if (!this.isThemeTask(task)) return undefined;
    if (bound.type !== 'no_console_errors') return undefined;
    if (!this.isOutcomeMenuAction(task, action, obs)) return undefined;
    const proof = this.primaryOutcomeTarget(task);
    return proof ? { type: 'text_visible', text: proof } : undefined;
  }

  private isLogoutTask(task: QaTask): boolean {
    return task.expectedOutcome?.kind === 'DEAUTHENTICATION';
  }

  private async trySemanticLogout(task: QaTask, scenario: QaScenario, config: RunConfig, runDir: string, runId: string, result: QaRunResult, attempts: AttemptRecord[], obs: ScreenObservation): Promise<boolean> {
    if (!this.isLogoutTask(task)) return false;
    const candidates = this.outcomeTargetCandidates(task);
    const target = obs.elements.find((e) => e.inViewport && this.matchesAnyCandidate(`${e.name} ${e.text ?? ''}`, candidates));
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

  private logoutObservationValidation(obs: ScreenObservation): { boundExpected: QaStep['boundExpected']; result: NonNullable<QaStep['validation']> } {
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

  private isTaskAlreadySatisfied(task: QaTask, config: RunConfig, obs: ScreenObservation): boolean {
    if (config.auth.kind === 'none') return false;
    if (task.expectedOutcome?.kind !== 'AUTHENTICATION') return false;
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
}
