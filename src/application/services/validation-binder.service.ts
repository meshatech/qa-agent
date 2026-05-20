import { Inject, Injectable } from '@nestjs/common';
import type { BoundExpectedAfterAction, ExpectedAfterAction } from '../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import { LocatorResolverService } from './locator-resolver.service.js';

@Injectable()
export class ValidationBinderService {
  constructor(@Inject(LocatorResolverService) private readonly locators: LocatorResolverService) {}

  bind(expected: ExpectedAfterAction, obs: ScreenObservation): BoundExpectedAfterAction {
    if (expected.type === 'field_value_contains') return { type: expected.type, target: this.target(obs, expected.targetElementId), value: expected.value };
    if (expected.type === 'element_visible') return { type: expected.type, target: expected.targetElementId ? this.target(obs, expected.targetElementId) : undefined, text: expected.text };
    return expected;
  }

  private target(obs: ScreenObservation, elementId: string) {
    return { originalElementId: elementId, observationId: obs.observationId, ...this.locators.resolve(obs.observationId, elementId) };
  }
}
