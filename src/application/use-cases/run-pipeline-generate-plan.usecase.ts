import { Inject, Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PipelineGeneratePlanRunResult } from '../dto/pipeline-generate-plan-result.dto.js';
import { readPipelineArtifact } from '../helpers/read-pipeline-artifact.js';
import { ExecutionPlanPlannerService, type PlannedExecutionPlan } from '../services/execution-plan-planner.service.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { SelectedScenariosSchema } from '../../domain/schemas/selected-scenarios.schema.js';
import { CorrelationResultSchema, type RequiredScenario } from '../../domain/schemas/correlation.schema.js';
import type { QaScenario } from '../../domain/schemas/qa-scenario.schema.js';
import { RunConfigSchema, type RunConfig } from '../../domain/schemas/config.schema.js';
import { applyBaseUrlOverride } from '../helpers/apply-base-url-override.js';
import { ConfigError } from '../../domain/errors.js';

const SELECTED_SCENARIOS_FILE = 'selected-scenarios.json';
const REQUIRED_SCENARIOS_FILE = 'required-scenarios.json';
const EXECUTION_PLAN_FILE = 'execution-plan.json';

@Injectable()
export class RunPipelineGeneratePlanUseCase {
  constructor(
    @Inject(ExecutionPlanPlannerService) private readonly planner: ExecutionPlanPlannerService,
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
  ) {}

  async execute(
    outputDir: string,
    options?: { configPath?: string; projectPath?: string },
  ): Promise<PipelineGeneratePlanRunResult> {
    const warnings: string[] = [];

    const scenarios = await this.resolveScenarios(outputDir, warnings);

    if (scenarios.length === 0) {
      warnings.push('No scenarios available (selected nor required); skipping plan generation.');
      return {
        warnings,
        qualityAudit: {
          semanticTargetsPerTask: 0,
          hasFragileTargets: false,
          hasGenericTargets: false,
          hasUnobservableTargets: false,
        },
      };
    }

    const config = await this.loadConfig(options?.configPath ?? 'agent-qa.config.json');

    let planned: PlannedExecutionPlan;
    try {
      planned = await this.planner.build(config, scenarios);
    } catch (error) {
      warnings.push(`ExecutionPlanPlanner failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        warnings,
        qualityAudit: {
          semanticTargetsPerTask: 0,
          hasFragileTargets: false,
          hasGenericTargets: false,
          hasUnobservableTargets: false,
        },
      };
    }

    if (!planned.plan) {
      warnings.push('ExecutionPlanPlanner returned no plan; nothing to persist.');
      return {
        warnings,
        qualityAudit: {
          semanticTargetsPerTask: 0,
          hasFragileTargets: false,
          hasGenericTargets: false,
          hasUnobservableTargets: false,
        },
      };
    }

    const qualityAudit = this.auditPlanQuality(planned.plan);

    const planWithMetadata = {
      ...planned.plan,
      metadata: {
        planSource: planned.source,
        fallbackReason: planned.fallbackReason,
        fallbackWarning: planned.fallbackReason ? `Plan used fallback: ${planned.fallbackReason}` : undefined,
        qualityAudit,
      },
    };

    const executionPlanPath = resolve(join(outputDir, EXECUTION_PLAN_FILE));
    await writeFile(
      executionPlanPath,
      JSON.stringify(planWithMetadata, null, 2),
      'utf8',
    );

    return {
      executionPlanPath,
      planSource: planned.source,
      fallbackReason: planned.fallbackReason,
      fallbackWarning: planned.fallbackReason ? `Plan used fallback: ${planned.fallbackReason}` : undefined,
      qualityAudit,
      warnings,
    };
  }

  /**
   * Cenários a planejar. Caminho normal: `selected-scenarios.json` (vindos da
   * memória). Se ele não existir ou vier vazio (cold start / nenhum match na
   * memória), cai pro factory: planeja os `required-scenarios.json` direto —
   * senão o pipeline travava na 1ª execução de qualquer repo (memória vazia).
   */
  private async resolveScenarios(outputDir: string, warnings: string[]): Promise<QaScenario[]> {
    let selectedScenarios: QaScenario[] = [];
    try {
      const selected = await readPipelineArtifact(outputDir, SELECTED_SCENARIOS_FILE, SelectedScenariosSchema);
      selectedScenarios = selected.scenarios;
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      warnings.push(`selected-scenarios.json unavailable (${error.message}); falling back to required scenarios.`);
    }

    if (selectedScenarios.length > 0) {
      return selectedScenarios;
    }

    let correlation;
    try {
      correlation = await readPipelineArtifact(outputDir, REQUIRED_SCENARIOS_FILE, CorrelationResultSchema);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      warnings.push(`required-scenarios.json unavailable (${error.message}); nothing to plan.`);
      return [];
    }
    if (correlation.scenarios.length === 0) {
      return [];
    }
    warnings.push(`Factory fallback: planning ${correlation.scenarios.length} required scenario(s) (no memory selection).`);
    return correlation.scenarios.map((required) => this.requiredToQaScenario(required));
  }

  private requiredToQaScenario(required: RequiredScenario): QaScenario {
    return {
      id: required.id,
      title: required.title,
      status: 'PLANNED',
      intent: required.intent,
      tasks: [
        {
          id: 'T001',
          title: required.title,
          expected: required.rationale || required.title,
          status: 'PENDING',
          intent: required.intent,
        },
      ],
    };
  }

  private async loadConfig(configPath: string): Promise<RunConfig> {
    const raw = await this.configLoader.load(configPath);
    return applyBaseUrlOverride(RunConfigSchema.parse(raw));
  }

  private auditPlanQuality(plan: import('../../domain/schemas/execution-plan.schema.js').ExecutionPlan): PipelineGeneratePlanRunResult['qualityAudit'] {
    let semanticTargetsPerTask = 0;
    let hasFragileTargets = false;
    let hasGenericTargets = false;
    const hasUnobservableTargets = false;

    for (const step of plan.steps) {
      const action = step.action;
      if ('target' in action && action.target) {
        const target = JSON.stringify(action.target);
        semanticTargetsPerTask++;
        if (/\bel_\d+\b/.test(target) || /targetElementId/.test(target)) {
          hasFragileTargets = true;
        }
        if (/button|input|div|span/i.test(target) && !/semantic/i.test(target)) {
          hasGenericTargets = true;
        }
      }
      if ('text' in action && action.text) {
        semanticTargetsPerTask++;
      }
    }

    return {
      semanticTargetsPerTask,
      hasFragileTargets,
      hasGenericTargets,
      hasUnobservableTargets,
    };
  }
}
