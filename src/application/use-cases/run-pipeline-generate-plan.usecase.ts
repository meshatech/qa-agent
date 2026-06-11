import { Inject, Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PipelineGeneratePlanRunResult } from '../dto/pipeline-generate-plan-result.dto.js';
import { readPipelineArtifact } from '../helpers/read-pipeline-artifact.js';
import { ExecutionPlanPlannerService, type PlannedExecutionPlan } from '../services/execution-plan-planner.service.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { SelectedScenariosSchema } from '../../domain/schemas/selected-scenarios.schema.js';
import { RunConfigSchema, type RunConfig } from '../../domain/schemas/config.schema.js';
import { applyBaseUrlOverride } from '../helpers/apply-base-url-override.js';

const SELECTED_SCENARIOS_FILE = 'selected-scenarios.json';
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

    const selected = await readPipelineArtifact(
      outputDir,
      SELECTED_SCENARIOS_FILE,
      SelectedScenariosSchema,
    );

    if (selected.scenarios.length === 0) {
      warnings.push('No scenarios found in selected-scenarios.json; skipping plan generation.');
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
      planned = await this.planner.build(config, selected.scenarios);
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
