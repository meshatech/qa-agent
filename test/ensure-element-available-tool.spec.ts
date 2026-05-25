import { describe, expect, it, vi } from 'vitest';

import { ALL_QA_TOOLS } from '../src/application/tools/built-in/index.js';
import { ElementEnsureAvailableTool } from '../src/application/tools/built-in/ensure_element_available.tool.js';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import { toStructuredToolLike } from '../src/infra/adapters/structured-tool.adapter.js';

const config = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D1', title: 'Smoke', description: 'Smoke' },
});

const observation = {
  observationId: 'obs-1',
  createdAt: new Date().toISOString(),
  url: 'https://app.local/inbox',
  title: 'Inbox',
  visibleTexts: ['Inbox'],
  elements: [{
    id: 'el_001',
    role: 'button',
    name: 'Conta e opções',
    inViewport: true,
    locator: { strategy: 'role', role: 'button', name: 'Conta e opções' },
  }],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
};

const target = { strategy: 'text_any' as const, texts: ['Sair', 'Logout'] };

const availabilityPolicy = {
  enabled: true,
  maxOpenAttempts: 1,
  allowedContainers: [{
    semanticKey: 'account_menu',
    openAction: {
      type: 'click' as const,
      target: { strategy: 'role' as const, role: 'button' as const, name: 'Conta e opções' },
      reason: 'open account menu',
    },
  }],
};

describe('qa.element.ensureAvailable', () => {
  it('is internalOnly and is hidden from public tool listings', () => {
    const registry = new QaToolRegistry(ALL_QA_TOOLS);

    expect(ElementEnsureAvailableTool.internalOnly).toBe(true);
    expect(registry.listPublic().map((tool) => tool.name)).not.toContain('qa.element.ensureAvailable');
    expect(registry.listAll().map((tool) => tool.name)).toContain('qa.element.ensureAvailable');
  });

  it('delegates to ElementAvailabilityResolver with normalized input and returns structured result', async () => {
    const result = {
      available: true,
      observation,
      openedContainer: 'account_menu',
      reobserved: true,
      reason: 'FOUND_AFTER_OPEN_CONTAINER',
      attempts: [{ actionType: 'click', result: 'PASSED', ts: '2026-05-22T00:00:00.000Z' }],
    };
    const elementAvailability = { ensureAvailable: vi.fn(async () => result) };
    const registry = new QaToolRegistry([ElementEnsureAvailableTool]);

    await expect(registry.execute('qa.element.ensureAvailable', {
      target,
      currentObservation: observation,
      availabilityPolicy,
      runContext: { stepId: 'S001' },
      config,
    }, {
      metadata: { elementAvailability },
    }, { includeInternal: true })).resolves.toEqual({
      ok: true,
      issues: [],
      result,
    });
    expect(elementAvailability.ensureAvailable).toHaveBeenCalledWith({
      target,
      observation,
      policy: availabilityPolicy,
      config,
      runContext: { stepId: 'S001' },
    });
  });

  it('blocks generic or arbitrary open actions before reaching the resolver', async () => {
    const elementAvailability = { ensureAvailable: vi.fn() };
    const registry = new QaToolRegistry([ElementEnsureAvailableTool]);

    await expect(registry.execute('qa.element.ensureAvailable', {
      target,
      currentObservation: observation,
      availabilityPolicy: {
        enabled: true,
        maxOpenAttempts: 1,
        allowedContainers: [{
          semanticKey: 'unsafe_coordinates',
          openAction: { type: 'clickAtCoordinates', x: 10, y: 10, reason: 'generic arbitrary click', risk: 'HIGH' },
        }],
      },
      config,
    }, {
      metadata: { elementAvailability },
    }, { includeInternal: true })).resolves.toMatchObject({
      ok: false,
      issues: [{
        path: 'availabilityPolicy',
        code: 'UNSAFE_AVAILABILITY_POLICY',
      }],
    });
    expect(elementAvailability.ensureAvailable).not.toHaveBeenCalled();
  });

  it('does not export to external structured adapters by default', () => {
    expect(toStructuredToolLike(ElementEnsureAvailableTool)).toBeUndefined();
  });
});
