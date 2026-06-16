import { describe, expect, it } from 'vitest';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import { DomainError } from '../src/domain/shared/result.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';

function makeObs(overrides: Partial<ScreenObservation> = {}): ScreenObservation {
  return {
    observationId: 'obs_1',
    createdAt: new Date().toISOString(),
    url: 'https://app.local/',
    title: 'App',
    visibleTexts: ['Salvar', 'Cancelar'],
    elements: [
      { id: 'el_001', role: 'button', name: 'Salvar', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Salvar' } },
      { id: 'el_002', role: 'textbox', name: 'Nome', inViewport: true, locator: { strategy: 'label', text: 'Nome' } },
      { id: 'el_003', role: 'button', name: 'Cancelar', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Cancelar' } },
    ],
    pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
    consoleSignals: [],
    networkSignals: [],
    meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
    ...overrides,
  };
}

describe('LocatorResolverService', () => {
  it('rebuilds and resolves element by id', () => {
    const service = new LocatorResolverService();
    const obs = makeObs();
    service.rebuild(obs);

    const result = service.resolve('obs_1', 'el_001');

    expect(result.locator).toEqual({ strategy: 'role', role: 'button', name: 'Salvar' });
    expect(result.humanName).toBe('Salvar');
  });

  it('throws on stale observation', () => {
    const service = new LocatorResolverService();
    service.rebuild(makeObs());
    expect(() => service.resolve('obs_2', 'el_001')).toThrow(DomainError);
  });

  it('throws when element id not found', () => {
    const service = new LocatorResolverService();
    service.rebuild(makeObs());
    expect(() => service.resolve('obs_1', 'el_999')).toThrow(DomainError);
  });

  it('finds element by role locator', () => {
    const service = new LocatorResolverService();
    const obs = makeObs();
    const id = service.findByLocator(obs, { strategy: 'role', role: 'button', name: 'Salvar' });
    expect(id).toBe('el_001');
  });

  it('finds element by label locator', () => {
    const service = new LocatorResolverService();
    const obs = makeObs();
    const id = service.findByLocator(obs, { strategy: 'label', text: 'Nome' });
    expect(id).toBe('el_002');
  });

  it('throws when locator not found', () => {
    const service = new LocatorResolverService();
    const obs = makeObs();
    expect(() => service.findByLocator(obs, { strategy: 'role', role: 'button', name: 'Inexistente' })).toThrow(DomainError);
  });

  it('finds element by semantic locator with candidates', () => {
    const service = new LocatorResolverService();
    const obs = makeObs();
    const id = service.findByLocator(obs, {
      strategy: 'semantic',
      semanticKey: 'save_button',
      intent: 'save form',
      candidates: [
        { strategy: 'role', role: 'button', name: 'Inexistente' },
        { strategy: 'role', role: 'button', name: 'Salvar' },
      ],
    });
    expect(id).toBe('el_001');
  });

  it('finds element by text_any locator', () => {
    const service = new LocatorResolverService();
    const obs = makeObs();
    const id = service.findByLocator(obs, { strategy: 'text_any', texts: ['Salvar', 'Save'] });
    expect(id).toBe('el_001');
  });

  it('finds element by text locator', () => {
    const service = new LocatorResolverService();
    const obs = makeObs();
    const id = service.findByLocator(obs, { strategy: 'text', text: 'Salvar' });
    expect(id).toBe('el_001');
  });
});
