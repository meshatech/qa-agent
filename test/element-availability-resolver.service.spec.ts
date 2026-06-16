import { describe, expect, it } from 'vitest';
import { ElementAvailabilityResolver } from '../src/application/services/element-availability-resolver.service.js';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import type { BrowserHarnessPort } from '../src/application/ports/browser-harness.port.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

function makeObs(overrides: Partial<ScreenObservation> = {}): ScreenObservation {
  return {
    observationId: 'obs_1',
    createdAt: new Date().toISOString(),
    url: 'https://app.local/',
    title: 'App',
    visibleTexts: ['Dashboard'],
    elements: [
      { id: 'el_001', role: 'button', name: 'Abrir menu', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Abrir menu' } },
      { id: 'el_002', role: 'menuitem', name: 'Sair', inViewport: false, locator: { strategy: 'role', role: 'menuitem', name: 'Sair' } },
    ],
    pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
    consoleSignals: [],
    networkSignals: [],
    meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
    ...overrides,
  };
}

const config = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D', title: 'T', description: 'D' },
  runtime: { elementAvailability: { enabled: true, maxOpenAttempts: 3, allowGlobalEscape: true, allowClickOutside: true, allowedContainers: [] } },
});

describe('ElementAvailabilityResolver', () => {
  it('returns FOUND_DIRECTLY when element exists', async () => {
    const browser: Partial<BrowserHarnessPort> = {};
    const locators = new LocatorResolverService();
    const resolver = new ElementAvailabilityResolver(browser as BrowserHarnessPort, locators);
    const obs = makeObs();

    const result = await resolver.ensureAvailable({
      target: { strategy: 'role', role: 'button', name: 'Abrir menu' },
      observation: obs,
      policy: { enabled: true, maxOpenAttempts: 3, allowedContainers: [], allowGlobalEscape: true, allowClickOutside: true },
      config,
    });

    expect(result.available).toBe(true);
    expect(result.reason).toBe('FOUND_DIRECTLY');
    expect(result.reobserved).toBe(false);
  });

  it('returns POLICY_DISABLED when policy is disabled', async () => {
    const browser: Partial<BrowserHarnessPort> = {};
    const locators = new LocatorResolverService();
    const resolver = new ElementAvailabilityResolver(browser as BrowserHarnessPort, locators);
    const obs = makeObs();

    const result = await resolver.ensureAvailable({
      target: { strategy: 'role', role: 'button', name: 'Inexistente' },
      observation: obs,
      policy: { enabled: false, maxOpenAttempts: 3, allowedContainers: [], allowGlobalEscape: true, allowClickOutside: true },
      config,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toBe('POLICY_DISABLED');
  });

  it('opens container when element is inside it', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async execute() { return { ok: true, actionType: 'click', durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async observe() {
        return makeObs({
          elements: [
            { id: 'el_001', role: 'button', name: 'Abrir menu', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Abrir menu' } },
            { id: 'el_002', role: 'menuitem', name: 'Sair', inViewport: true, locator: { strategy: 'role', role: 'menuitem', name: 'Sair' } },
          ],
        });
      },
    };
    const locators = new LocatorResolverService();
    const resolver = new ElementAvailabilityResolver(browser as BrowserHarnessPort, locators);
    // Initial observation does NOT contain the target element
    const obs = makeObs({ elements: [{ id: 'el_001', role: 'button', name: 'Abrir menu', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Abrir menu' } }] });

    const result = await resolver.ensureAvailable({
      target: { strategy: 'role', role: 'menuitem', name: 'Sair' },
      observation: obs,
      policy: {
        enabled: true,
        maxOpenAttempts: 3,
        allowedContainers: [{
          semanticKey: 'account_menu',
          openAction: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Abrir menu' }, reason: 'open menu' },
        }],
        allowGlobalEscape: true,
        allowClickOutside: true,
      },
      config,
    });

    expect(result.available).toBe(true);
    expect(result.reason).toBe('FOUND_AFTER_OPEN_CONTAINER');
    expect(result.openedContainer).toBe('account_menu');
    expect(result.reobserved).toBe(true);
  });

  it('returns NOT_FOUND when element and container are missing', async () => {
    const browser: Partial<BrowserHarnessPort> = {};
    const locators = new LocatorResolverService();
    const resolver = new ElementAvailabilityResolver(browser as BrowserHarnessPort, locators);
    const obs = makeObs();

    const result = await resolver.ensureAvailable({
      target: { strategy: 'role', role: 'button', name: 'Inexistente' },
      observation: obs,
      policy: { enabled: true, maxOpenAttempts: 3, allowedContainers: [], allowGlobalEscape: true, allowClickOutside: true },
      config,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toBe('NOT_FOUND');
  });
});
