import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { DomPurifier } from '../src/infra/observation/dom-purifier.js';

const html = `<!doctype html>
<html><head><title>t</title>
<script>window.x=1</script>
<style>body{color:red}</style>
<meta name="csrf-token" content="abc">
</head>
<body>
  <svg width="50" height="50"><circle r="20"/></svg>
  <canvas id="c"></canvas>
  <button onclick="alert(1)" class="btn aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa long-class" data-internal="x" data-testid="save">Salvar</button>
  <input id="pwd" type="password" name="senha" value="hidden-secret" />
  <input type="hidden" name="token" value="x" />
  <div style="display:none">should be removed</div>
</body></html>`;

let server: Server;
let browser: Browser;
let baseUrl = '';

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

describe('DomPurifier', () => {
  it('removes scripts/styles/svg/canvas and inline handlers', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(baseUrl);
    const out = await new DomPurifier().purifyHtml(page);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/<svg/i);
    expect(out).not.toMatch(/<canvas/i);
    expect(out).not.toMatch(/onclick=/i);
    expect(out).not.toMatch(/data-internal/i);
    expect(out).toMatch(/data-testid="save"/);
    expect(out).not.toMatch(/long-class/);
    await ctx.close();
  }, 30000);

  it('purifyForEvidence masks password values', () => {
    const out = new DomPurifier().purifyForEvidence('<input type="password" value="secret-real">');
    expect(out).toContain('value="***"');
    expect(out).not.toContain('secret-real');
  });

  it('fallbackElements returns interactive elements only', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(baseUrl);
    const elements = await new DomPurifier().fallbackElements(page);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.some((e) => e.role === 'button' && e.name === 'Salvar')).toBe(true);
    expect(elements.every((e) => !e.value || !e.value.includes('hidden-secret'))).toBe(true);
    await ctx.close();
  }, 30000);
});
