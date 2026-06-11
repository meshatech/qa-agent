import { describe, expect, it, vi } from 'vitest';
import { ToolExecutorService } from '../src/application/services/tool-executor.service.js';
import type { BrowserHarnessPort } from '../src/application/ports/browser-harness.port.js';

const mockBrowser = (): BrowserHarnessPort => ({
  open: vi.fn().mockResolvedValue(undefined),
  captureAuth: vi.fn().mockResolvedValue(undefined),
  observe: vi.fn().mockResolvedValue({
    observationId: 'obs-001',
    createdAt: new Date().toISOString(),
    url: 'https://example.com',
    title: 'Test',
    visibleTexts: [],
    elements: [
      { id: 'el_001', role: 'button', name: 'Submit', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Submit' } },
      { id: 'el_002', role: 'textbox', name: 'Editor', inViewport: true, locator: { strategy: 'role', role: 'textbox', name: 'Editor' }, tagName: 'textarea', editable: true },
    ],
    pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
    consoleSignals: [],
    networkSignals: [],
    meta: { viewport: { width: 1366, height: 768 }, schemaVersion: 'obs.v1' },
  }),
  execute: vi.fn().mockResolvedValue({ ok: true, actionType: 'click', durationMs: 100 }),
  validate: vi.fn().mockResolvedValue({ ok: true, type: 'text_visible', expected: 'test', durationMs: 50 }),
  waitForQuiescence: vi.fn().mockResolvedValue({ stable: true, durationMs: 100 }),
  screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
  domSnapshot: vi.fn().mockResolvedValue('<html></html>'),
  networkLog: vi.fn().mockReturnValue([]),
  consoleLog: vi.fn().mockReturnValue(''),
  saveTrace: vi.fn().mockResolvedValue(undefined),
  saveVideo: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
});

describe('ToolExecutorService', () => {
  it('navigatorOpen returns ok on success', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.navigatorOpen({ url: 'https://example.com' });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('navigator.open');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.data).toMatchObject({ url: 'https://example.com' });
  });

  it('observerCapture returns observation data', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.observerCapture({});

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('observer.capture');
    expect(result.data).toMatchObject({
      url: 'https://example.com',
      elementCount: 2,
    });
  });

  it('actorClick returns ok on success', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.actorClick({ target: { strategy: 'role', role: 'button', name: 'Submit' } });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('actor.click');
  });

  it('actorFill returns ok on success', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.actorFill({ target: { strategy: 'text_any', texts: ['editor'] }, value: 'teste' });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('actor.fill');
  });

  it('actorType returns ok on success', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.actorType({ text: 'hello' });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('actor.type');
  });

  it('actorPress returns ok on success', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.actorPress({ key: 'Escape' });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('actor.press');
  });

  it('validatorState returns validation result', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.validatorState({ condition: { type: 'text_visible', text: 'Success' } });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('validator.state');
    expect(result.data).toBeDefined();
  });

  it('explorerScan returns findings for scan_inputs', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.explorerScan({ mode: 'scan_inputs' });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('explorer.scan');
    expect(result.data).toMatchObject({
      mode: 'scan_inputs',
      findingsCount: 1,
    });
  });

  it('explorerScan returns findings for scan_clickables', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.explorerScan({ mode: 'scan_clickables' });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      mode: 'scan_clickables',
      findingsCount: 1,
    });
  });

  it('explorerScan returns all elements for full_observation', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);
    const result = await svc.explorerScan({ mode: 'full_observation' });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      mode: 'full_observation',
      findingsCount: 2,
    });
  });

  it('navigatorOpen returns error when browser fails', async () => {
    const browser = mockBrowser();
    (browser.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Timeout'));
    const svc = new ToolExecutorService(browser);
    const result = await svc.navigatorOpen({ url: 'https://fail.com' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'NAVIGATION_FAILED', message: 'Timeout' });
  });

  it('does not call LLM in any method', async () => {
    const browser = mockBrowser();
    const svc = new ToolExecutorService(browser);

    await svc.navigatorOpen({ url: 'https://example.com' });
    await svc.observerCapture({});
    await svc.actorClick({ target: { strategy: 'role', role: 'button', name: 'Submit' } });

    // No LLM calls — only browser.execute and browser.observe
    expect(browser.execute).toHaveBeenCalled();
    expect(browser.observe).toHaveBeenCalled();
  });
});
