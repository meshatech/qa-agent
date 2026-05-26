import { Injectable } from '@nestjs/common';
import type { DecisionInput, DecisionProviderPort, ReplanInput } from '../../application/ports/decision-provider.port.js';
import type { QaScenario } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { ExecutionPlan, PlanPatch } from '../../domain/schemas/execution-plan.schema.js';

@Injectable()
export class FakeDecisionProvider implements DecisionProviderPort {
  private calls = 0;

  async plan(config: RunConfig): Promise<QaScenario[]> {
    return [{
      id: 'scenario-001',
      title: config.demand.title,
      status: 'PLANNED',
      intent: 'POSITIVE',
      tasks: [{ id: 'T001', title: config.demand.description, expected: config.demand.description, status: 'PENDING', intent: 'POSITIVE' }],
    }];
  }

  async buildPlan(config: RunConfig, _scenarios?: QaScenario[]): Promise<ExecutionPlan> {
    this.calls++;
    const text = `${config.demand.title} ${config.demand.description}`;
    const isNameFill = /\b(preencher|fill|campo|field|nome|name)\b/i.test(text);
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
      steps: [{
        id: 'S001',
        description: isNameFill ? 'Fake guarded fill by label' : 'Fake guarded visible state check',
        preconditions: isNameFill ? [{ type: 'element_visible', target: { strategy: 'role', role: 'textbox' } }] : [],
        action: isNameFill
          ? { type: 'fill', target: { strategy: 'role', role: 'textbox' }, value: '{{uniqueName:fakeName:Agent QA}}', reason: 'fill name field' }
          : { type: 'waitForStable', timeoutMs: 1000, reason: 'fake guarded smoke' },
        postconditions: isNameFill
          ? [{ type: 'field_value_contains', target: { strategy: 'role', role: 'textbox' }, value: '{{ref:fakeName}}' }]
          : [{ type: 'text_any_visible', texts: [config.demand.title, config.demand.description] }],
        assertions: [],
        onFailure: 'RECOVER',
      }],
      assertions: [],
    };
  }

  async replan(input: ReplanInput): Promise<PlanPatch> {
    this.calls++;
    return {
      basePlanId: input.plan.planId,
      basePlanVersion: input.plan.version,
      operation: 'mark_blocked',
      stepId: input.failedStep.id,
      reason: `Fake provider cannot replan: ${input.message}`,
      replanReason: input.reason,
      steps: [],
    };
  }

  async decide({ observation }: DecisionInput): Promise<QaActionEnvelope> {
    this.calls++;
    const input = observation.elements.find((e) => e.role === 'textbox') ?? observation.elements[0];
    return {
      schemaVersion: 'action.v1',
      observationId: observation.observationId,
      thought_summary: 'Preencher o primeiro campo observável para validar o fluxo.',
      action: { type: 'fill', targetElementId: input.id, value: '{{uniqueName:smokeName:Agent QA}}', reason: 'smoke fill' },
      expected_after_action: { type: 'field_value_contains', targetElementId: input.id, value: '{{ref:smokeName}}' },
      fallback_action: { type: 'press', key: 'Escape', reason: 'fallback padrão' },
      confidence: 0.8,
    };
  }

  stats() {
    return { calls: this.calls, breakdown: { plan: 0, buildPlan: 0, replan: 0, decide: 0 } };
  }
}
