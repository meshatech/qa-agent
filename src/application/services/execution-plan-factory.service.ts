import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionPlan, ExecutionStep, PlanAction } from '../../domain/schemas/execution-plan.schema.js';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';
import type { ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ExpectedOutcomeResolverService } from './expected-outcome-resolver.service.js';

@Injectable()
export class ExecutionPlanFactoryService {
  constructor(
    @Inject(ExpectedOutcomeResolverService)
    private readonly outcomeResolver: ExpectedOutcomeResolverService,
  ) {}

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
        const targetUrl = outcome.target ? `${config.baseUrl}${outcome.target}` : config.baseUrl;
        return [this.makeStep(scenarioId, task, { type: 'navigate', to: targetUrl, reason: outcome.description }, [{ type: 'route_state', expected: 'matches', expectedUrlPattern: targetUrl }])];
      }
      case 'DATA_ENTRY': {
        const dataTarget = await this.semanticTarget(outcome, config);
        if (!dataTarget) {
          return [this.makeSafeCheckStep(scenarioId, task, outcome.description)];
        }
        return [this.makeStep(scenarioId, task, { type: 'fill', target: dataTarget, value: 'safe-test-value', reason: outcome.description }, [{ type: 'no_console_errors' }])];
      }
      case 'CLASSIFICATION_FAILED':
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
    const texts = config?.runtime.semanticAliases?.[outcome.kind] ?? this.splitCandidates(outcome.target ?? outcome.description ?? '');
    if (texts.length === 1 && texts[0] === 'NO_REGRESSION') return null;
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
