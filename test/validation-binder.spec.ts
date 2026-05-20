import { describe, expect, it } from 'vitest';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import { ValidationBinderService } from '../src/application/services/validation-binder.service.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';

describe('ValidationBinderService', () => {
  it('binds expected target to locator', () => {
    const observation: ScreenObservation = {
      observationId: 'obs_1',
      createdAt: new Date().toISOString(),
      url: 'http://local',
      title: '',
      visibleTexts: [],
      elements: [{ id: 'el_001', role: 'textbox', name: 'Nome', inViewport: true, locator: { strategy: 'label', text: 'Nome' } }],
      pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
      consoleSignals: [],
      networkSignals: [],
      meta: { viewport: { width: 1, height: 1 }, schemaVersion: 'obs.v1' },
    };
    const resolver = new LocatorResolverService();
    resolver.rebuild(observation);
    const bound = new ValidationBinderService(resolver).bind({ type: 'field_value_contains', targetElementId: 'el_001', value: 'x' }, observation);
    expect(bound.type).toBe('field_value_contains');
    if (bound.type === 'field_value_contains') expect(bound.target.locator).toEqual({ strategy: 'label', text: 'Nome' });
  });
});
