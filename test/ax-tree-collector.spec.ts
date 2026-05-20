import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { AxTreeCollector } from '../src/infra/observation/ax-tree.collector.js';

let server: Server;
let baseUrl = '';
let browser: Browser;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html>
      <html><body>
        <main>
          <h1>Cadastro de produto</h1>
          <label>Nome do produto <input name="name" required value="Café" /></label>
          <label><input type="checkbox" checked /> Ativo</label>
          <button type="button" disabled>Salvar</button>
          <a href="/help">Ajuda</a>
          <button aria-hidden="true">Botão oculto</button>
        </main>
      </body></html>`);
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

describe('AxTreeCollector parser', () => {
  it('parses YAML-like aria snapshot with refs and boxes', () => {
    const collector = new AxTreeCollector();
    const raw = [
      '- list "Links" [ref=e1] [box=10,20,300,40]:',
      '  - listitem [ref=e2] [box=10,30,300,20]:',
      '    - link "Home" [ref=e3] [box=20,30,40,15]',
      '  - listitem [ref=e4]:',
      '    - link "About" [ref=e5]',
    ].join('\n');
    const tree = collector.parseTree(raw);
    expect(tree).not.toBeNull();
    expect(tree!.role).toBe('list');
    expect(tree!.name).toBe('Links');
    expect(tree!.bounds).toEqual({ x: 10, y: 20, width: 300, height: 40 });
    expect(tree!.children).toHaveLength(2);
    expect(tree!.children[0]!.children[0]!.role).toBe('link');
    expect(tree!.children[0]!.children[0]!.ref).toBe('e3');
  });

  it('extracts interesting elements with role-name locators', () => {
    const collector = new AxTreeCollector();
    const raw = [
      '- form "Cadastro":',
      '  - textbox "Nome" [ref=e10] [required]',
      '  - textbox "Senha" [ref=e11]',
      '  - button "Salvar" [ref=e12] [disabled]',
      '  - text: "irrelevant copy"',
    ].join('\n');
    const tree = collector.parseTree(raw);
    expect(tree).not.toBeNull();
    const elements = (collector as unknown as { collectElements: (n: unknown, out: unknown[], c: { value: number }) => void }).collectElements;
    const out: { id: string; role: string; name: string; required?: boolean; disabled?: boolean }[] = [];
    elements.call(collector, tree, out, { value: 0 });
    expect(out.map((e) => e.role)).toEqual(['textbox', 'textbox', 'button']);
    expect(out[0]!.required).toBe(true);
    expect(out[2]!.disabled).toBe(true);
    expect(out[0]!.id).toMatch(/^el_\d{3}$/);
  });

  it('collects native Chromium AX tree with backend refs and element bounds', async () => {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await ctx.newPage();
    await page.goto(baseUrl);

    const result = await new AxTreeCollector().collect(page);

    expect(result.source).toBe('cdp');
    expect(result.tree).not.toBeNull();
    expect(result.raw).toContain('Cadastro de produto');
    const names = result.elements.map((e) => e.name);
    expect(names).toContain('Nome do produto');
    expect(names).toContain('Ativo');
    expect(names).toContain('Salvar');
    expect(names).toContain('Ajuda');
    expect(names).not.toContain('Botão oculto');

    const input = result.elements.find((e) => e.name === 'Nome do produto');
    expect(input?.source).toBe('ax');
    expect(input?.axRef).toMatch(/^backend:\d+$/);
    expect(input?.bounds?.width).toBeGreaterThan(0);
    expect(input?.required).toBe(true);

    const checkbox = result.elements.find((e) => e.name === 'Ativo');
    expect(checkbox?.checked).toBe(true);

    const save = result.elements.find((e) => e.name === 'Salvar');
    expect(save?.disabled).toBe(true);
    await ctx.close();
  }, 30000);
});
