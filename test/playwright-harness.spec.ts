import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

beforeAll(async () => {
  const html = await readFile(join(process.cwd(), 'test/fixtures/smoke.html'));
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
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
});
