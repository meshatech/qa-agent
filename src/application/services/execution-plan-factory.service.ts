import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
        return [this.makeStep(scenarioId, task, { type: 'click', target: disclosureTarget, reason: outcome.description }, [{ type: 'menu_state', semanticKey: outcome.target ?? 'menu', expected: 'open' }])];
      }
      case 'NAVIGATION': {
        let targetUrl: string;
        if (outcome.target) {
          if (outcome.target.includes('..')) {
            throw new Error(`Navigation target contains path traversal: ${outcome.target}`);
          }
          targetUrl = new URL(outcome.target, config.baseUrl).href;
          const targetProtocol = new URL(targetUrl).protocol;
          if (!['http:', 'https:'].includes(targetProtocol)) {
            throw new Error(`Navigation target uses unsupported protocol: ${targetProtocol}`);
          }
          const baseHost = new URL(config.baseUrl).host;
          const targetHost = new URL(targetUrl).host;
          if (targetHost !== baseHost) {
            throw new Error(`Navigation target resolves to external host: ${targetHost}`);
          }
        } else {
          targetUrl = config.baseUrl;
        }
        return [this.makeStep(scenarioId, task, { type: 'navigate', to: targetUrl, reason: outcome.description }, [{ type: 'route_state', expected: 'matches', expectedUrlPattern: targetUrl }])];
      }
      case 'DATA_ENTRY': {
        const dataTarget = await this.semanticTarget(outcome, config);
        if (!dataTarget) {
          return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
        }
        const testValue = this.valueGenerator?.generate(task.title, outcome) ?? 'safe-test-value';
        return [this.makeStep(scenarioId, task, { type: 'fill', target: dataTarget, value: testValue, reason: outcome.description }, [{ type: 'no_console_errors' }])];
      }
      case 'CLASSIFICATION_FAILED':
        throw new Error(`Expected outcome classification failed for task "${task.id}"; cannot generate safe execution step`);
      case 'NO_REGRESSION':
      default:
        return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
    }
  }

  private makeStep(scenarioId: string, task: QaTask, action: PlanAction, postconditions: ExecutionStep['postconditions']): ExecutionStep {
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
    };
  }

  private makeSafeCheckStep(scenarioId: string, task: QaTask, reason: string): ExecutionStep {
    return this.makeStep(scenarioId, task, { type: 'waitForStable', timeoutMs: 1000, reason }, [{ type: 'no_console_errors' }]);
  }

  private async logoutSteps(scenarioId: string, task: QaTask, config: RunConfig, outcome: ExpectedOutcome): Promise<ExecutionStep[]> {
    const target = await this.semanticTarget(outcome, config);
    if (!target) {
      return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
    }
    const logoutStep: ExecutionStep = {
      id: `${task.id}-logout`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action: { type: 'click', target, reason: outcome.description },
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
    const themeStep: ExecutionStep = {
      id: `${task.id}-theme`,
      scenarioId,
      taskId: task.id,
      description: task.title,
      preconditions: [],
      action: { type: 'click', target, reason: outcome.description },
      postconditions: [{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'exists', source: 'dom' }],
      assertions: [],
      onFailure: 'RECOVER',
    };
    return [themeStep];
  }

  private async semanticTarget(outcome: ExpectedOutcome, config?: RunConfig): Promise<LocatorDescriptor | null> {
    if (!this.SEMANTIC_TARGET_KINDS.has(outcome.kind)) return null;
    const texts = config?.runtime.semanticAliases?.[outcome.kind] ?? this.splitCandidates(outcome.target ?? outcome.description ?? '');
    if (texts.length === 1 && texts[0] === 'NO_REGRESSION') return null;
    if (config) {
      for (const text of texts) {
        if (!this.actionPolicy.validateDestructiveText(text, config).ok) {
          throw new Error(`Unsafe semantic target blocked by destructive action policy: ${text}`);
        }
      }
    }
    return {
      strategy: 'text_any',
      texts,
    };
  }

  private splitCandidates(value: string): string[] {
    const candidates = value.includes('|') ? value.split('|').map((candidate) => candidate.trim()).filter(Boolean) : [value].filter(Boolean);
    return candidates.length ? candidates : ['NO_REGRESSION'];
  }
}
