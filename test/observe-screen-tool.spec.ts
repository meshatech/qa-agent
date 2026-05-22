import { describe, expect, it, vi } from 'vitest';

import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';
import { ScreenObserveTool } from '../src/application/tools/built-in/observe_screen.tool.js';

const observation = {
  observationId: 'obs-1',
  createdAt: new Date().toISOString(),
  url: 'https://app.local/inbox',
  title: 'Inbox',
  visibleTexts: ['Inbox'],
  elements: [{
    id: 'el_001',
    role: 'button',
    name: 'Compose',
    text: 'Compose',
    inViewport: true,
    locator: { strategy: 'role', role: 'button', name: 'Compose' },
  }],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [
    { level: 'warn', text: 'Minor warning', isAppOrigin: true, timestamp: new Date().toISOString() },
    { level: 'error', text: 'Third-party error', isAppOrigin: false, timestamp: new Date().toISOString() },
  ],
  networkSignals: [],
  meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
};

describe('qa.screen.observe', () => {
  it('is registered as a public safe tool', () => {
    const registry = new QaToolRegistry([ScreenObserveTool]);

    expect(registry.listPublic()).toEqual([{
      name: 'qa.screen.observe',
      description: 'Return a controlled ScreenObservation from the current browser session without executing actions.',
      internalOnly: false,
    }]);
  });

  it('returns a structured screen observation with controlled options', async () => {
    const browser = {
      observe: vi.fn(async () => observation),
      domSnapshot: vi.fn(async () => '<main>Inbox</main>'),
      screenshot: vi.fn(async () => Buffer.from('png')),
      execute: vi.fn(),
      waitForQuiescence: vi.fn(),
    };
    const registry = new QaToolRegistry([ScreenObserveTool]);

    await expect(registry.execute('qa.screen.observe', {
      includeDom: true,
      includeScreenshot: true,
      includeAccessibilityTree: true,
      includeUrl: true,
      includeConsoleSummary: true,
    }, {
      metadata: { browser },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        observation: { observationId: 'obs-1', url: 'https://app.local/inbox' },
        url: 'https://app.local/inbox',
        domSnapshot: '<main>Inbox</main>',
        screenshotBase64: Buffer.from('png').toString('base64'),
        accessibilityTree: [{ id: 'el_001', role: 'button', name: 'Compose', text: 'Compose' }],
        consoleSummary: { total: 2, byLevel: { warn: 1, error: 1 }, appOriginCount: 1 },
      },
    });
    expect(browser.observe).toHaveBeenCalledOnce();
    expect(browser.domSnapshot).toHaveBeenCalledOnce();
    expect(browser.screenshot).toHaveBeenCalledOnce();
    expect(browser.execute).not.toHaveBeenCalled();
    expect(browser.waitForQuiescence).not.toHaveBeenCalled();
  });

  it('does not expose optional browser data unless requested', async () => {
    const browser = {
      observe: vi.fn(async () => observation),
      domSnapshot: vi.fn(),
      screenshot: vi.fn(),
    };
    const registry = new QaToolRegistry([ScreenObserveTool]);
    const result = await registry.execute('qa.screen.observe', {}, { metadata: { browser } });

    expect(result).toMatchObject({ ok: true, result: { observation: { observationId: 'obs-1' }, url: 'https://app.local/inbox' } });
    expect(JSON.stringify(result)).not.toContain('domSnapshot');
    expect(JSON.stringify(result)).not.toContain('screenshotBase64');
    expect(JSON.stringify(result)).not.toContain('accessibilityTree');
    expect(JSON.stringify(result)).not.toContain('consoleSummary');
    expect(browser.domSnapshot).not.toHaveBeenCalled();
    expect(browser.screenshot).not.toHaveBeenCalled();
  });
});
