import { describe, expect, it } from 'vitest';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';

const obs = (id: string): ScreenObservation => ({
  observationId: id,
  createdAt: new Date().toISOString(),
  url: 'http://local',
  title: '',
  visibleTexts: [],
  elements: [{ id: 'el_001', role: 'textbox', name: 'Nome', inViewport: true, locator: { strategy: 'label', text: 'Nome' } }],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1, height: 1 }, schemaVersion: 'obs.v1' },
});

describe('LocatorResolverService', () => {
  it('resolves current observation', () => {
    const resolver = new LocatorResolverService();
    resolver.rebuild(obs('obs_a'));
    expect(resolver.resolve('obs_a', 'el_001').humanName).toBe('Nome');
  });

  it('rejects stale observation', () => {
    const resolver = new LocatorResolverService();
    resolver.rebuild(obs('obs_a'));
    expect(() => resolver.resolve('obs_b', 'el_001')).toThrow(/current/);
  });
});
