import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlaywrightHarness } from '../src/infra/playwright/playwright-harness.js';
import { PlaywrightQuiescenceGuard } from '../src/infra/playwright/playwright-quiescence.guard.js';
import { ObservationService } from '../src/infra/observation/observation.service.js';
import { AxTreeCollector } from '../src/infra/observation/ax-tree.collector.js';
import { DomPurifier } from '../src/infra/observation/dom-purifier.js';
import { PageStateDetector } from '../src/infra/observation/page-state.detector.js';
import { SignalsCollector } from '../src/infra/observation/signals-buffer.js';
import { FormLoginService } from '../src/infra/playwright/auth/form-login.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

function buildHarness() {
  const ax = new AxTreeCollector();
  const dom = new DomPurifier();
  const state = new PageStateDetector();
  const signals = new SignalsCollector();
  const observation = new ObservationService(ax, dom, state);
  return new PlaywrightHarness(new PlaywrightQuiescenceGuard(), observation, signals, new FormLoginService());
}

let server: Server;
let baseUrl = '';
let retryRequests = 0;

beforeAll(async () => {
  const html = await readFile(join(process.cwd(), 'test/fixtures/smoke.html'));
  const roadmap = await readFile(join(process.cwd(), 'test/fixtures/roadmap-v1.html'));
  server = createServer((req, res) => {
    if (req.url === '/retry' && retryRequests++ === 0) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url === '/roadmap' ? roadmap : html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr !== 'object' || !addr) throw new Error('server failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PlaywrightHarness', () => {
  it('observes, fills and validates a bound field', async () => {
    const harness = buildHarness();
    await harness.open(RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Smoke', description: 'Smoke' },
      llm: { provider: 'fake' },
    }));
    const obs = await harness.observe();
    const nameEl = obs.elements.find((e) => e.name.toLowerCase().includes('nome'));
    expect(nameEl).toBeDefined();
    await harness.execute({ type: 'fill', targetElementId: nameEl!.id, value: 'Agent QA', reason: 'test' });
    const result = await harness.validate({
      type: 'field_value_contains',
      target: { originalElementId: nameEl!.id, observationId: obs.observationId, locator: nameEl!.locator },
      value: 'Agent QA',
    });
    await harness.close();
    expect(result.ok).toBe(true);
  }, 30000);

  it('recovers observe when the active page was closed unexpectedly', async () => {
    const harness = buildHarness();
    await harness.open(RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Smoke', description: 'Smoke' },
      llm: { provider: 'fake' },
    }));
    await (harness as unknown as { page: { close: () => Promise<void> } }).page.close();

    const obs = await harness.observe();

    expect(obs.elements.length).toBeGreaterThan(0);
    await harness.close();
  }, 30000);

  it('recovers observe when the context was closed unexpectedly', async () => {
    const harness = buildHarness();
    await harness.open(RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Smoke', description: 'Smoke' },
      llm: { provider: 'fake' },
    }));
    await (harness as unknown as { context: { close: () => Promise<void> } }).context.close();

    const obs = await harness.observe();

    expect(obs.elements.length).toBeGreaterThan(0);
    await harness.close();
  }, 30000);

  it('executes roadmap browser capabilities without exposing Playwright', async () => {
    const harness = buildHarness();
    await harness.open(RunConfigSchema.parse({ baseUrl: `${baseUrl}/roadmap`, appDomains: ['127.0.0.1'], demand: { id: 'D', title: 'Roadmap', description: 'Roadmap' }, llm: { provider: 'fake' } }));
    const obs = await harness.observe();
    const id = (name: string) => obs.elements.find((element) => element.name.includes(name))!.id;
    const file = join(tmpdir(), `agent-qa-${Date.now()}.txt`);
    const baseline = join(tmpdir(), `agent-qa-${Date.now()}.png`);
    await writeFile(file, 'fixture');

    expect((await harness.execute({ type: 'drag', sourceElementId: id('Origem'), targetElementId: id('Destino'), reason: 'test drag' })).ok).toBe(true);
    expect((await harness.execute({ type: 'uploadFile', targetElementId: id('Arquivo'), filePath: file, reason: 'test upload' })).ok).toBe(true);
    expect((await harness.execute({ type: 'click', targetElementId: id('Iniciar'), reason: 'start status' })).ok).toBe(true);
    expect((await harness.execute({ type: 'waitForCondition', text: 'Concluído', reason: 'wait status' })).ok).toBe(true);
    expect((await harness.execute({ type: 'richTextFill', targetElementId: id('Editor'), value: 'texto rico', reason: 'fill editor' })).ok).toBe(true);
    expect((await harness.execute({ type: 'extract', targetElementId: id('Editor'), key: 'editor', source: 'text', reason: 'extract editor' })).data).toBe('texto rico');
    expect((await harness.compareScreenshot(baseline)).baselineCreated).toBe(true);
    expect((await harness.compareScreenshot(baseline)).ok).toBe(true);
    await harness.execute({ type: 'richTextFill', targetElementId: id('Editor'), value: 'layout alterado', reason: 'change screenshot' });
    expect((await harness.compareScreenshot(baseline, 0)).ok).toBe(false);
    expect((await harness.auditAccessibility()).some((violation) => violation.id === 'button-name')).toBe(true);
    expect((await harness.execute({ type: 'click', targetElementId: id('Abrir diálogo'), reason: 'open dialog' })).ok).toBe(true);
    expect((await harness.execute({ type: 'acceptDialog', text: 'Confirmar', reason: 'accept dialog' })).ok).toBe(true);

    await harness.close();
    await rm(file, { force: true });
    await rm(baseline, { force: true });
  }, 60000);

  it('retries transient navigation failures with configured backoff', async () => {
    retryRequests = 0;
    const harness = buildHarness();
    await harness.open(RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Retry', description: 'Retry' },
      llm: { provider: 'fake' },
      timeouts: { navigationRetry: { maxAttempts: 2, backoffMs: 1 } },
    }));
    const result = await harness.execute({ type: 'navigate', to: `${baseUrl}/retry`, reason: 'test retry' });
    await harness.close();
    expect(result.ok).toBe(true);
    expect(retryRequests).toBe(2);
  }, 30000);
});
