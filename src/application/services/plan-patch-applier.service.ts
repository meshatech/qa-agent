import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../domain/shared/result.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ExecutionPlanSchema, PlanPatchSchema, type ExecutionPlan, type ExecutionStep, type PlanPatch } from '../../domain/schemas/execution-plan.schema.js';
import { ActionPolicyService } from './action-policy.service.js';

export interface AppliedPlanPatch {
  plan: ExecutionPlan;
  history: {
    basePlanId: string;
    basePlanVersion: number;
    operation: PlanPatch['operation'];
    stepId?: string;
    reason: string;
    replanReason: PlanPatch['replanReason'];
    appliedPlanVersion?: number;
    status: 'APPLIED' | 'BLOCKED';
    patch: PlanPatch;
  };
}

@Injectable()
export class PlanPatchApplierService {
  constructor(@Inject(ActionPolicyService) private readonly actionPolicy: ActionPolicyService) {}

  apply(current: ExecutionPlan, rawPatch: unknown, config: RunConfig): AppliedPlanPatch {
    const patch = PlanPatchSchema.parse(rawPatch);
    if (patch.basePlanId !== current.planId) throw new DomainError('STALE_PLAN_PATCH', 'Patch basePlanId does not match current plan');
    if (patch.basePlanVersion !== current.version) throw new DomainError('STALE_PLAN_PATCH', 'Patch basePlanVersion does not match current plan version');
    this.assertPatchSafety(current, patch, config);

    if (patch.operation === 'mark_blocked') {
      return { plan: current, history: this.history(patch, 'BLOCKED') };
    }

    const stepId = patch.stepId!;
    const index = current.steps.findIndex((step) => step.id === stepId);
    if (index < 0) throw new DomainError('PATCH_STEP_NOT_FOUND', `Step not found for patch: ${stepId}`);

    const steps =
      patch.operation === 'insert_after' ? [...current.steps.slice(0, index + 1), ...patch.steps, ...current.steps.slice(index + 1)] :
      patch.operation === 'replace_step' ? [...current.steps.slice(0, index), ...patch.steps, ...current.steps.slice(index + 1)] :
      [...current.steps.slice(0, index), ...patch.steps];

    const plan = ExecutionPlanSchema.parse({ ...current, version: current.version + 1, steps });
    return { plan, history: this.history(patch, 'APPLIED', plan.version) };
  }

  private assertPatchSafety(current: ExecutionPlan, patch: PlanPatch, config: RunConfig): void {
    for (const step of patch.steps) {
      const policy = this.actionPolicy.validateDestructiveText(`${step.description} ${'reason' in step.action ? step.action.reason : ''}`, config);
      if (!policy.ok) throw new DomainError(policy.code, policy.message);
      if (step.onFailure === 'CONTINUE_WITH_WARNING' && !['MODAL_OR_OVERLAY_DETECTED'].includes(patch.replanReason)) {
        throw new DomainError('WEAKENED_VALIDATION', 'Patch cannot turn a functional step into CONTINUE_WITH_WARNING');
      }
    }

    const affected = this.affectedSteps(current, patch);
    if (!affected.length) return;
    for (const original of affected) {
      if (original.postconditions.length > 0 && patch.operation !== 'insert_after' && patch.steps.some((step) => step.postconditions.length === 0)) {
        throw new DomainError('WEAKENED_VALIDATION', 'Patch cannot remove primary postconditions');
      }
      if (original.assertions.length > 0 && patch.operation !== 'insert_after') {
        const hasCriticalAssertions = patch.steps.some((step) => step.assertions.length >= original.assertions.length);
        if (!hasCriticalAssertions) throw new DomainError('WEAKENED_VALIDATION', 'Patch cannot remove critical business assertions');
      }
    }
  }

  private affectedSteps(current: ExecutionPlan, patch: PlanPatch): ExecutionStep[] {
    if (patch.operation === 'mark_blocked' || patch.operation === 'insert_after') return [];
    const index = current.steps.findIndex((step) => step.id === patch.stepId);
    if (index < 0) return [];
    return patch.operation === 'replace_step' ? [current.steps[index]!] : current.steps.slice(index);
  }

  private history(patch: PlanPatch, status: 'APPLIED' | 'BLOCKED', appliedPlanVersion?: number): AppliedPlanPatch['history'] {
    return {
      basePlanId: patch.basePlanId,
      basePlanVersion: patch.basePlanVersion,
      operation: patch.operation,
      stepId: patch.stepId,
      reason: patch.reason,
      replanReason: patch.replanReason,
      appliedPlanVersion,
      status,
      patch,
    };
  }
}
