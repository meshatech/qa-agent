import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { posix as posixPath } from 'node:path';
import type { ExecutionPlan, ExecutionStep, PlanAction } from '../../domain/schemas/execution-plan.schema.js';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';
import type { ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ActionPolicyService } from './action-policy.service.js';
import { ExpectedOutcomeResolverService } from './expected-outcome-resolver.service.js';
import { ValueGeneratorService } from './value-generator.service.js';

@Injectable()
export class ExecutionPlanFactoryService {
  private readonly logger = new Logger(ExecutionPlanFactoryService.name);
  private readonly actionPolicy: ActionPolicyService;
  private readonly SEMANTIC_TARGET_KINDS = new Set<ExpectedOutcome['kind']>(['DISCLOSURE', 'DATA_ENTRY', 'DEAUTHENTICATION', 'APPEARANCE_CHANGE']);

  constructor(
    @Inject(ExpectedOutcomeResolverService)
    private readonly outcomeResolver: ExpectedOutcomeResolverService,
    @Optional()
    @Inject(ActionPolicyService)
    actionPolicy?: ActionPolicyService,
    @Optional()
    @Inject(ValueGeneratorService)
    private readonly valueGenerator?: ValueGeneratorService,
  ) {
    this.actionPolicy = actionPolicy ?? new ActionPolicyService();
  }

  async fromScenarios(config: RunConfig, scenarios: QaScenario[]): Promise<ExecutionPlan | undefined> {
    const steps: ExecutionStep[] = [];
    for (const scenario of scenarios) {
      for (const task of scenario.tasks) {
        const taskSteps = await this.stepsForTask(scenario.id, task, config);
        steps.push(...taskSteps);
      }
    }
    if (!steps.length) return undefined;
    return {
      schemaVersion: 'execution-plan.v1',
      planId: `plan_${config.demand.id}`,
      version: 1,
      goal: config.demand.title,
      mode: config.runtime.mode,
      runtime: {
        maxAttemptsPerStep: config.runtime.maxAttemptsPerStep,
        maxReplansPerScenario: config.runtime.maxReplansPerScenario,
        destructiveActionPolicy: config.runtime.destructiveActionPolicy,
      },
      steps,
      assertions: [],
    };
  }

  private async stepsForTask(scenarioId: string, task: QaTask, config: RunConfig): Promise<ExecutionStep[]> {
    const outcome = task.expectedOutcome ?? await this.outcomeResolver.resolve(config, task);
    if (outcome.kind === 'CLASSIFICATION_FAILED') {
      this.logger.warn(`Expected outcome classification failed for task "${task.id}"; refusing to generate a passing fallback step`);
      return [this.makeSafeCheckStep(scenarioId, task, `Classification failed: ${outcome.description}`)];
    }
    return this.contractSteps(scenarioId, task, config, outcome);
  }

  /**
   * Builds concrete steps from the typed ExpectedOutcome.
   * Semantic keys (not literal words) are used as targets so the LLM/harness
   * can resolve them on the actual page at runtime.
   */
  private async contractSteps(scenarioId: string, task: QaTask, config: RunConfig, outcome: ExpectedOutcome): Promise<ExecutionStep[]> {
    if (config.auth.kind === 'none' && (outcome.kind === 'AUTHENTICATION' || outcome.kind === 'DEAUTHENTICATION')) {
      return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
    }
    switch (outcome.kind) {
      case 'AUTHENTICATION':
        return [this.makeStep(scenarioId, task, { type: 'waitForStable', timeoutMs: 1000, reason: outcome.description }, [{ type: 'auth_state', expected: 'authenticated' }])];
      case 'DEAUTHENTICATION':
        return this.logoutSteps(scenarioId, task, config, outcome);
      case 'APPEARANCE_CHANGE':
        return this.themeSteps(scenarioId, task, config, outcome);
      case 'DISCLOSURE': {
        const disclosureTarget = await this.semanticTarget(outcome, config);
        if (!disclosureTarget) {
          return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
        }
        const clickTarget = { strategy: 'text_any' as const, texts: [disclosureTarget.texts[0]!] };
        const openIndicators = [...new Set([
          ...disclosureTarget.texts,
          'Perfil',
          'Assinatura',
          'Sair',
          'Logout',
          'Tema',
          'Aparência',
        ])];
        return [
          this.makeStep(
            scenarioId,
            task,
            { type: 'click', target: clickTarget, reason: `Open container: ${outcome.description}` },
            [{ type: 'text_any_visible', texts: openIndicators }],
          ),
        ];
      }
      case 'NAVIGATION': {
        let targetUrl: string;
        const sanitizedTarget = outcome.target?.trim();
        if (sanitizedTarget) {
          if (this.hasPathTraversal(sanitizedTarget)) {
            this.logger.warn(`Navigation target contains path traversal; emitting safe check step: ${sanitizedTarget}`);
            return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
          }
          try {
            targetUrl = new URL(sanitizedTarget, config.baseUrl).href;
          } catch (error) {
            this.logger.warn(`Failed to resolve navigation target "${sanitizedTarget}" against baseUrl "${config.baseUrl}": ${error instanceof Error ? error.message : String(error)}; emitting safe check step`);
            return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
          }
          const resolved = new URL(targetUrl);
          if (!['http:', 'https:'].includes(resolved.protocol)) {
            this.logger.warn(`Navigation target uses unsupported protocol "${resolved.protocol}"; emitting safe check step: ${sanitizedTarget}`);
            return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
          }
          if (this.hasPathTraversal(resolved.pathname)) {
            this.logger.warn(`Navigation target contains path traversal after resolution; emitting safe check step: ${sanitizedTarget}`);
            return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
          }
          const baseHost = new URL(config.baseUrl).host;
          if (resolved.host !== baseHost) {
            this.logger.warn(`Navigation target resolves to external host "${resolved.host}"; emitting safe check step: ${sanitizedTarget}`);
            return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
          }
          const basePath = posixPath.normalize(new URL(config.baseUrl).pathname || '/');
          if (basePath !== '/') {
            const resolvedPath = posixPath.normalize(this.decodeTarget(resolved.pathname));
            if (!resolvedPath.startsWith(basePath)) {
              this.logger.warn(`Navigation target escapes base path "${basePath}"; emitting safe check step: ${sanitizedTarget}`);
              return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
            }
          }
        } else {
          targetUrl = config.baseUrl;
          if (this.hasPathTraversal(targetUrl)) {
            this.logger.warn(`Navigation baseUrl contains path traversal; emitting safe check step: ${targetUrl}`);
            return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
          }
          try {
            const resolved = new URL(targetUrl);
            if (!['http:', 'https:'].includes(resolved.protocol)) {
              this.logger.warn(`Navigation baseUrl uses unsupported protocol "${resolved.protocol}"; emitting safe check step`);
              return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
            }
            if (this.hasPathTraversal(resolved.pathname)) {
              this.logger.warn(`Navigation baseUrl contains path traversal after resolution; emitting safe check step`);
              return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
            }
          } catch {
            this.logger.warn(`Navigation baseUrl is not a valid URL; emitting safe check step: ${targetUrl}`);
            return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
          }
        }
        return [this.makeStep(scenarioId, task, { type: 'navigate', to: targetUrl, reason: outcome.description }, [{ type: 'route_state', expected: 'matches', expectedUrlPattern: targetUrl }])];
      }
      case 'DATA_ENTRY': {
        const dataTarget = await this.dataEntryTarget(outcome, config);
        if (!dataTarget) {
          return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
        }
        let testValue = this.valueGenerator?.generate(task.title, outcome) ?? 'safe-test-value';
        const check = this.actionPolicy.validateDestructiveText(testValue, config);
        if (!check.ok) {
          this.logger.warn(`Generated DATA_ENTRY value "${testValue}" blocked by destructive policy; using safe-test-value (${check.message})`);
          testValue = 'safe-test-value';
        }
        return [this.makeStep(scenarioId, task, { type: 'fill', target: dataTarget, value: testValue, reason: outcome.description }, [{ type: 'field_value_contains', target: dataTarget, value: testValue }])];
      }
      case 'CLASSIFICATION_FAILED':
        throw new Error(`Expected outcome classification failed for task "${task.id}"; cannot generate safe execution step`);
      case 'NO_REGRESSION':
      default:
        return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
    }
  }

  private makeStep(scenarioId: string, task: QaTask, action: PlanAction, postconditions: ExecutionStep['postconditions'], isFallback?: boolean): ExecutionStep {
    return {
      id: `${task.id}-outcome`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action,
      postconditions,
      assertions: [],
      onFailure: 'RECOVER',
      ...(isFallback ? { isFallback: true } : {}),
    };
  }

  private makeSafeCheckStep(scenarioId: string, task: QaTask, reason: string): ExecutionStep {
    return this.makeStep(scenarioId, task, { type: 'waitForStable', timeoutMs: 1000, reason }, [{ type: 'no_console_errors' }], true);
  }

  private async logoutSteps(scenarioId: string, task: QaTask, config: RunConfig, outcome: ExpectedOutcome): Promise<ExecutionStep[]> {
    const target = await this.semanticTarget(outcome, config);
    if (!target) {
      return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
    }
    const primaryLabel = target.texts[0]!;
    const clickTarget = {
      strategy: 'semantic' as const,
      semanticKey: 'logout_action',
      intent: 'logout from application',
      candidates: [
        { strategy: 'role' as const, role: 'menuitem', name: primaryLabel },
        { strategy: 'role' as const, role: 'button', name: primaryLabel },
        { strategy: 'text' as const, text: primaryLabel, exact: true },
        { strategy: 'text_any' as const, texts: [primaryLabel] },
      ],
    };
    const logoutStep: ExecutionStep = {
      id: `${task.id}-logout`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action: { type: 'click', target: clickTarget, reason: outcome.description },
      postconditions: [{ type: 'auth_state', expected: 'anonymous' }],
      assertions: [],
      onFailure: 'RECOVER',
    };
    return [logoutStep];
  }

  private async themeSteps(scenarioId: string, task: QaTask, config: RunConfig, outcome: ExpectedOutcome): Promise<ExecutionStep[]> {
    const target = await this.semanticTarget(outcome, config);
    if (!target) {
      return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
    }
    const primaryLabel = target.texts[0]!;
    const clickTarget = {
      strategy: 'semantic' as const,
      semanticKey: 'appearance_toggle',
      intent: 'toggle visual theme',
      candidates: [
        { strategy: 'role' as const, role: 'switch', name: primaryLabel },
        { strategy: 'role' as const, role: 'menuitem', name: primaryLabel },
        { strategy: 'text' as const, text: primaryLabel, exact: true },
        { strategy: 'text_any' as const, texts: target.texts.slice(0, 3) },
      ],
    };
    const themeStep: ExecutionStep = {
      id: `${task.id}-theme`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action: { type: 'click', target: clickTarget, reason: outcome.description },
      postconditions: [{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'exists', source: 'dom' }],
      assertions: [],
      onFailure: 'RECOVER',
    };
    return [themeStep];
  }

  private async semanticTarget(outcome: ExpectedOutcome, config: RunConfig): Promise<{ strategy: 'text_any'; texts: string[] } | null> {
    if (outcome.kind === 'NO_REGRESSION') return null;
    if (!this.SEMANTIC_TARGET_KINDS.has(outcome.kind)) return null;
    const texts = config.runtime.semanticAliases?.[outcome.kind] ?? this.splitCandidates(outcome.target ?? outcome.description ?? '');
    if (!texts.length || texts.some((text) => text.trim().length < 2)) {
      this.logger.warn(`Semantic target for ${outcome.kind} has empty or too-short candidates; emitting safe check step`);
      return null;
    }
    const filteredTexts = texts.filter((text) => text !== 'NO_REGRESSION');
    if (!filteredTexts.length) {
      this.logger.warn(`Semantic target for ${outcome.kind} has no valid candidates after filtering NO_REGRESSION; emitting safe check step`);
      return null;
    }
    const safeTexts: string[] = [];
    for (const text of filteredTexts) {
      let ok = false;
      try {
        ok = this.actionPolicy.validateDestructiveText(text, config).ok;
      } catch (error) {
        this.logger.warn(`validateDestructiveText threw for "${text}": ${error instanceof Error ? error.message : String(error)}; skipping candidate`);
        continue;
      }
      if (!ok) {
        this.logger.warn(`Skipping unsafe semantic target candidate blocked by destructive action policy: ${text}`);
        continue;
      }
      safeTexts.push(text);
    }
    if (!safeTexts.length) return null;
    return { strategy: 'text_any', texts: safeTexts };
  }

  private async dataEntryTarget(outcome: ExpectedOutcome, config: RunConfig): Promise<LocatorDescriptor | null> {
    const semantic = await this.semanticTarget(outcome, config);
    if (!semantic) return null;
    return {
      strategy: 'semantic',
      semanticKey: outcome.target ?? 'data_entry',
      intent: 'resolve editable text input',
      candidates: [semantic, { strategy: 'role', role: 'textbox' }],
    };
  }

  private hasPathTraversal(rawPath: string): boolean {
    const decoded = this.decodeTarget(rawPath);
    const normalized = posixPath.normalize(decoded);
    return decoded.split('/').includes('..') || normalized.split('/').includes('..');
  }

  private decodeTarget(value: string, depth = 0): string {
    if (depth >= 3 && value.includes('%')) {
      this.logger.warn(`decodeTarget reached max depth with remaining encoded characters in: ${value.slice(0, 200)}`);
      return value;
    }
    if (!value.includes('%')) return value;
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) return value;
      return this.decodeTarget(decoded, depth + 1);
    } catch {
      return value;
    }
  }

  private splitCandidates(value: string): string[] {
    const candidates = value.includes('|') ? value.split('|').map((candidate) => candidate.trim()).filter(Boolean) : [value].filter(Boolean);
    return candidates;
  }
}
