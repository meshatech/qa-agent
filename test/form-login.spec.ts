import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser } from 'playwright';
import { launchBrowser } from './helpers/playwright-launch.js';
import { FormLoginService } from '../src/infra/playwright/auth/form-login.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import { HarnessFatalError } from '../src/domain/errors.js';

let server: Server;
let baseUrl = '';
let browser: Browser;

beforeAll(async () => {
  const html = await readFile(join(process.cwd(), 'test/fixtures/login.html'));
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr !== 'object' || !addr) throw new Error('server failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  browser = await launchBrowser(true);
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const formAuth = {
  kind: 'formLogin' as const,
  loginUrl: '/',
  usernameSelector: '#email',
  passwordSelector: '#password',
  submitSelector: '#submit',
  usernameEnv: 'QA_USERNAME_TEST',
  passwordEnv: 'QA_PASSWORD_TEST',
  errorTextSelector: '#error',
  successWhen: { textVisible: 'Bem-vindo ao Dashboard' },
};

describe('FormLoginService', () => {
  it('logs in successfully with successWhen.textVisible', async () => {
    process.env.QA_USERNAME_TEST = 'qa@app.local';
    process.env.QA_PASSWORD_TEST = 'good-password';
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const config = RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Login', description: 'Login flow' },
      auth: formAuth,
    });
    await new FormLoginService().login(page, config);
    expect(await page.locator('#dashboard').isVisible()).toBe(true);
    await ctx.close();
  }, 30000);

  it('throws HarnessFatalError when error text appears', async () => {
    process.env.QA_USERNAME_TEST = 'qa@app.local';
    process.env.QA_PASSWORD_TEST = 'wrong';
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const config = RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Login', description: 'Login flow' },
      auth: { ...formAuth, maxRetries: 0 },
    });
    await expect(new FormLoginService().login(page, config)).rejects.toBeInstanceOf(HarnessFatalError);
    await ctx.close();
  }, 30000);

  it('throws ConfigError-equivalent when env missing', async () => {
    delete process.env.QA_USERNAME_TEST;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const config = RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Login', description: 'Login flow' },
      auth: formAuth,
    });
    await expect(new FormLoginService().login(page, config)).rejects.toBeInstanceOf(HarnessFatalError);
    await ctx.close();
  }, 30000);

  it('supports LocatorDescriptor selectors end to end', async () => {
    process.env.QA_USERNAME_TEST = 'qa@app.local';
    process.env.QA_PASSWORD_TEST = 'good-password';
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const config = RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Login', description: 'Login flow' },
      auth: {
        ...formAuth,
        usernameSelector: { strategy: 'label', text: 'E-mail' },
        passwordSelector: { strategy: 'label', text: 'Senha' },
        submitSelector: { strategy: 'role', role: 'button', name: 'Entrar' },
      },
    });
    await new FormLoginService().login(page, config);
    expect(page.url()).toContain('/dashboard');
    await ctx.close();
  }, 30000);

  it('does not leak the wrong password in the fatal login error', async () => {
    process.env.QA_USERNAME_TEST = 'qa@app.local';
    process.env.QA_PASSWORD_TEST = 'super-secret-wrong-password';
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const config = RunConfigSchema.parse({
      baseUrl,
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Login', description: 'Login flow' },
      auth: { ...formAuth, maxRetries: 1 },
    });
    let error: unknown;
    try {
      await new FormLoginService().login(page, config);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(HarnessFatalError);
    expect((error as Error).message).toMatch(/Credenciais inválidas/);
    expect((error as Error).message).not.toContain('super-secret-wrong-password');
    await ctx.close();
  }, 30000);
});
