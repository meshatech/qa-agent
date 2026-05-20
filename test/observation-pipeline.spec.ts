import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { ObservationService } from '../src/infra/observation/observation.service.js';
import { AxTreeCollector } from '../src/infra/observation/ax-tree.collector.js';
import { DomPurifier } from '../src/infra/observation/dom-purifier.js';
import { PageStateDetector } from '../src/infra/observation/page-state.detector.js';
import { SignalsCollector } from '../src/infra/observation/signals-buffer.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const html = `<!doctype html>
<html><head><title>obs</title></head>
<body>
  <h1>Cadastro</h1>
  <label>Nome <input name="name" /></label>
  <label>Email <input name="email" type="email" required /></label>
  <select aria-label="Categoria"><option>Geral</option><option>Bebidas</option></select>
  <button type="button" data-testid="save">Salvar</button>
  <div role="dialog" aria-modal="true">
    <p>Confirmar?</p>
    <button>Sim</button>
  </div>
</body></html>`;

let server: Server;
let baseUrl = '';
let browser: Browser;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr !== 'object' || !addr) throw new Error('server failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('ObservationService pipeline', () => {
  it('merges AX + DOM elements with stable ids and bounds', async () => {
    const config = RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const signalsCollector = new SignalsCollector();
    const buffer = signalsCollector.createBuffer();
    signalsCollector.attach(page, config, buffer);
    await page.goto(baseUrl);
    const service = new ObservationService(new AxTreeCollector(), new DomPurifier(), new PageStateDetector());
    const obs = await service.observe(page, buffer);
    expect(obs.observationId).toMatch(/^obs_/);
    expect(obs.elements.length).toBeGreaterThan(0);
    expect(obs.elements.every((e) => /^el_\d{3}$/.test(e.id))).toBe(true);
    const save = obs.elements.find((e) => e.name.toLowerCase() === 'salvar');
    expect(save).toBeDefined();
    expect(save!.locator.strategy === 'testid' || save!.locator.strategy === 'role').toBe(true);
    expect(obs.pageState.hasModal).toBe(true);
    expect(obs.meta.schemaVersion).toBe('obs.v1');
    expect(obs.meta.accessibilitySource).toBe('cdp');
    expect(obs.meta.accessibilityNodeCount).toBeGreaterThan(obs.elements.length);
    await ctx.close();
  }, 30000);
});
