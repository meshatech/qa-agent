import { Injectable } from '@nestjs/common';
import type { DecisionInput, DecisionProviderPort } from '../../application/ports/decision-provider.port.js';
import type { QaScenario } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';

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
    return { calls: this.calls };
  }
}
