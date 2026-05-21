import { Inject, Injectable } from '@nestjs/common';
import { PlanPatchSchema, type ExecutionPlan, type PlanPatch } from '../../domain/schemas/execution-plan.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { DecisionProviderPort, ReplanInput } from '../ports/decision-provider.port.js';
import { DomainError } from '../../domain/shared/result.js';
import { PlanPatchApplierService, type AppliedPlanPatch } from './plan-patch-applier.service.js';

@Injectable()
export class PlanReplannerService {
  constructor(
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
    @Inject(PlanPatchApplierService) private readonly applier: PlanPatchApplierService,
  ) {}

  validatePatch(raw: unknown): PlanPatch {
    const candidate = typeof raw === 'object' && raw && Array.isArray((raw as { patches?: unknown[] }).patches)
      ? (raw as { patches: unknown[] }).patches[0]
      : raw;
    return PlanPatchSchema.parse(candidate);
  }

  async replan(input: ReplanInput): Promise<AppliedPlanPatch> {
    if (!this.decision.replan) throw new DomainError('REPLAN_UNAVAILABLE', 'Decision provider does not support replan');
    const patch = this.validatePatch(await this.decision.replan(input));
    return this.applier.apply(input.plan, patch, input.config);
  }

  apply(config: RunConfig, plan: ExecutionPlan, rawPatch: unknown): AppliedPlanPatch {
    return this.applier.apply(plan, this.validatePatch(rawPatch), config);
  }
}
