import { describe, expect, it } from 'vitest';
import { ElementAvailabilityResolver } from '../src/application/services/element-availability-resolver.service.js';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { BrowserHarnessPort } from '../src/application/ports/browser-harness.port.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';

const obs = (open = false): ScreenObservation => ({
  observationId: `obs-${open}`,
  createdAt: new Date().toISOString(),
  url: 'https://app.local/',
  title: 'App',
  visibleTexts: open ? ['Sair'] : ['JN'],
  elements: open
    ? [
        { id: 'el_001', role: 'button', name: 'JN', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Conta e opções' } },
        { id: 'el_002', role: 'menuitem', name: 'Sair', inViewport: true, locator: { strategy: 'role', role: 'menuitem', name: 'Sair' } },
      ]
    : [{ id: 'el_001', role: 'button', name: 'JN', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Conta e opções' } }],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
});

const config = RunConfigSchema.parse({ baseUrl: 'https://app.local', appDomains: ['app.local'], demand: { id: 'D', title: 'T', description: 'D' } });

describe('ElementAvailabilityResolver', () => {
  it('opens only allowed container and finds target after reobserve', async () => {
    let current = obs(false);
    const locators = new LocatorResolverService();
    locators.rebuild(current);
    const browser: Partial<BrowserHarnessPort> = {
      async execute() { current = obs(true); return { ok: true, actionType: 'click', durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async observe() { locators.rebuild(current); return current; },
    };
    const result = await new ElementAvailabilityResolver(browser as BrowserHarnessPort, locators).ensureAvailable({
      target: { strategy: 'text_any', texts: ['Sair', 'Logout'] },
      observation: current,
      config,
      policy: {
        enabled: true,
        maxOpenAttempts: 1,
        allowedContainers: [{ semanticKey: 'account_menu', openAction: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Conta e opções' }, reason: 'open menu' } }],
      },
    });

    expect(result.available).toBe(true);
    expect(result.reason).toBe('FOUND_AFTER_OPEN_CONTAINER');
  });

  it('uses target directly when it is already visible in the open menu', async () => {
    const current = obs(true);
    const locators = new LocatorResolverService();
    locators.rebuild(current);
    const browser: Partial<BrowserHarnessPort> = {
      async execute() { throw new Error('should not open container'); },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async observe() { return current; },
    };
    const result = await new ElementAvailabilityResolver(browser as BrowserHarnessPort, locators).ensureAvailable({
      target: { strategy: 'text_any', texts: ['Sair', 'Logout'] },
      observation: current,
      config,
      policy: {
        enabled: true,
        maxOpenAttempts: 1,
        allowedContainers: [{ semanticKey: 'account_menu', openAction: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Conta e opções' }, reason: 'open menu' } }],
      },
    });

    expect(result.available).toBe(true);
    expect(result.reason).toBe('FOUND_DIRECTLY');
  });

  it('does not open containers when policy is disabled', async () => {
    const current = obs(false);
    const locators = new LocatorResolverService();
    locators.rebuild(current);
    const result = await new ElementAvailabilityResolver({} as BrowserHarnessPort, locators).ensureAvailable({
      target: { strategy: 'text', text: 'Sair' },
      observation: current,
      config,
      policy: { enabled: false, maxOpenAttempts: 1, allowedContainers: [] },
    });

    expect(result.available).toBe(false);
    expect(result.reason).toBe('POLICY_DISABLED');
  });
});
