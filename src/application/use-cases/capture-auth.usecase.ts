import { Inject, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { ConfigError } from '../../domain/errors.js';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

@Injectable()
export class CaptureAuthUseCase {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject('ConfigLoaderPort') private readonly loader: ConfigLoaderPort,
  ) {}

  async execute(configPath: string, outputPath: string): Promise<{ ok: true; outputPath: string }> {
    let config;
    try {
      config = RunConfigSchema.parse(await this.loader.load(configPath));
    } catch (error) {
      throw new ConfigError(error instanceof ZodError ? error.message : String(error), error);
    }

    const engine: BrowserType = config.browser.engine === 'firefox' ? firefox : config.browser.engine === 'webkit' ? webkit : chromium;
    const browser = await engine.launch({ headless: false, slowMo: config.browser.slowMoMs });
    const context = await browser.newContext({ viewport: config.browser.viewport });
    const page = await context.newPage();

    if (config.auth.kind === 'ssoRedirect') {
      await this.handleSsoRedirect(config, page, outputPath);
    } else if (config.auth.kind === 'formLogin') {
      await this.handleFormLogin(config, page, outputPath);
    } else {
      await this.handleManual(config, page, outputPath);
    }

    await mkdir(dirname(outputPath), { recursive: true }).catch(() => undefined);
    await context.storageState({ path: outputPath });
    await browser.close();

    console.log(`Session saved to ${outputPath}`);
    return { ok: true, outputPath };
  }

  private async handleSsoRedirect(config: import('../../domain/schemas/config.schema.js').RunConfig, page: Page, _outputPath: string): Promise<void> {
    const auth = config.auth as { kind: 'ssoRedirect'; loginUrl?: string; loginButtonSelector: string | import('../../domain/schemas/action.schema.js').LocatorDescriptor; idpUsernameSelector?: string | import('../../domain/schemas/action.schema.js').LocatorDescriptor; idpPasswordSelector?: string | import('../../domain/schemas/action.schema.js').LocatorDescriptor; idpSubmitSelector?: string | import('../../domain/schemas/action.schema.js').LocatorDescriptor; usernameEnv?: string; passwordEnv?: string; successUrlContains?: string; successWhen?: { urlContains?: string; textVisible?: string }; storageStatePath: string };
    const url = auth.loginUrl ? new URL(auth.loginUrl, config.baseUrl).toString() : config.baseUrl;

    console.log(`[SSO] Opening ${url}`);
    await page.goto(url, { timeout: config.timeouts.navigationMs });

    console.log(`[SSO] Clicking login button: ${JSON.stringify(auth.loginButtonSelector)}`);
    await this.clickWithFallback(page, auth.loginButtonSelector, config.timeouts.actionMs);

    console.log('[SSO] Waiting for SSO redirect...');
    await page.waitForTimeout(3000);

    const success = auth.successWhen ?? (auth.successUrlContains ? { urlContains: auth.successUrlContains } : undefined);
    const isSuccess = success?.urlContains ? page.url().includes(success.urlContains) : false;

    if (!isSuccess && auth.idpUsernameSelector && auth.idpPasswordSelector && auth.idpSubmitSelector) {
      const username = auth.usernameEnv ? process.env[auth.usernameEnv] : undefined;
      const password = auth.passwordEnv ? process.env[auth.passwordEnv] : undefined;
      const userLocator = this.toLocator(page, auth.idpUsernameSelector);
      const hasLoginFields = await userLocator.isVisible().catch(() => false);

      if (hasLoginFields) {
        if (username && password) {
          console.log('[SSO] IdP login screen detected. Filling credentials automatically...');
          const passLocator = this.toLocator(page, auth.idpPasswordSelector);
          const submitLocator = this.toLocator(page, auth.idpSubmitSelector);
          await userLocator.fill(username);
          await passLocator.fill(password);
          await submitLocator.click();
          console.log('[SSO] Submitted IdP credentials. Waiting for redirect...');
        } else {
          console.log('[SSO] IdP login screen detected. Please enter your credentials in the browser and log in.');
          console.log(`[SSO] After logging in, press ENTER in this terminal to save the session.`);
          await new Promise<void>((resolve) => { process.stdin.once('data', () => resolve()); });
        }
      }
    }

    if (success?.urlContains && !page.url().includes(success.urlContains)) {
      console.log(`[SSO] Waiting for URL to contain: ${success.urlContains} (current: ${page.url()})`);
      try {
        await page.waitForURL((u) => u.toString().includes(success.urlContains!), { timeout: config.timeouts.navigationMs });
        console.log(`[SSO] Reached success URL: ${page.url()}`);
      } catch {
        console.log(`[SSO] Timed out waiting for success URL. Current URL: ${page.url()}`);
        console.log('[SSO] Please finish authentication in the browser, then press ENTER here to save the session.');
        await new Promise<void>((resolve) => { process.stdin.once('data', () => resolve()); });
      }
    }

    if (success?.textVisible) {
      await page.getByText(success.textVisible).first().waitFor({ state: 'visible', timeout: config.timeouts.actionMs }).catch(() => undefined);
    }

    console.log(`[SSO] Authentication flow completed. Current URL: ${page.url()}`);
  }

  private async handleFormLogin(config: import('../../domain/schemas/config.schema.js').RunConfig, page: Page, _outputPath: string): Promise<void> {
    console.log(`Browser opened. Navigate to ${config.baseUrl}, log in manually if needed, then press ENTER in this terminal to save session`);
    await page.goto(config.baseUrl, { timeout: config.timeouts.navigationMs }).catch(() => undefined);
    await new Promise<void>((resolve) => { process.stdin.once('data', () => resolve()); });
  }

  private async handleManual(config: import('../../domain/schemas/config.schema.js').RunConfig, page: Page, _outputPath: string): Promise<void> {
    console.log(`Browser opened. Navigate to ${config.baseUrl}, log in manually, then press ENTER in this terminal to save session`);
    await page.goto(config.baseUrl, { timeout: config.timeouts.navigationMs }).catch(() => undefined);
    await new Promise<void>((resolve) => { process.stdin.once('data', () => resolve()); });
  }

  private async clickWithFallback(page: Page, selector: string | import('../../domain/schemas/action.schema.js').LocatorDescriptor, timeoutMs: number): Promise<void> {
    const attempts: { name: string; locator: import('playwright').Locator }[] = [];

    if (typeof selector === 'string') {
      attempts.push({ name: 'string locator', locator: page.locator(selector) });
      attempts.push({ name: 'role button fallback', locator: page.getByRole('button', { name: selector, exact: false }) });
      attempts.push({ name: 'text fallback', locator: page.getByText(selector, { exact: false }).first() });
    } else if (selector.strategy === 'text') {
      attempts.push({ name: 'text', locator: page.getByText(selector.text, { exact: selector.exact }) });
      attempts.push({ name: 'role button', locator: page.getByRole('button', { name: selector.text, exact: selector.exact }) });
      attempts.push({ name: 'css has-text', locator: page.locator(`button:has-text("${selector.text}")`) });
      attempts.push({ name: 'text first', locator: page.getByText(selector.text, { exact: false }).first() });
    } else if (selector.strategy === 'role') {
      attempts.push({ name: 'role', locator: page.getByRole(selector.role as Parameters<Page['getByRole']>[0], { name: selector.name, exact: selector.exact }) });
      if (selector.name) {
        attempts.push({ name: 'text fallback', locator: page.getByText(selector.name, { exact: selector.exact }).first() });
        attempts.push({ name: 'css role+name', locator: page.locator(`${selector.role}:has-text("${selector.name}")`) });
      }
    } else {
      attempts.push({ name: 'primary', locator: this.toLocator(page, selector) });
    }

    for (const attempt of attempts) {
      try {
        console.log(`[SSO] Trying ${attempt.name}...`);
        await attempt.locator.waitFor({ state: 'visible', timeout: timeoutMs / 3 });
        await attempt.locator.click({ timeout: timeoutMs / 3 });
        console.log(`[SSO] Clicked using ${attempt.name}`);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('strict mode violation')) {
          console.log(`[SSO] ${attempt.name} resolved to multiple elements, trying next...`);
          continue;
        }
        console.log(`[SSO] ${attempt.name} failed: ${msg.slice(0, 80)}`);
      }
    }

    throw new Error(`All click attempts failed for selector: ${JSON.stringify(selector)}`);
  }

  private toLocator(page: Page, selector: string | import('../../domain/schemas/action.schema.js').LocatorDescriptor): import('playwright').Locator {
    if (typeof selector === 'string') return page.locator(selector);
    if (selector.strategy === 'role') return page.getByRole(selector.role as Parameters<Page['getByRole']>[0], { name: selector.name, exact: selector.exact });
    if (selector.strategy === 'label') return page.getByLabel(selector.text, { exact: selector.exact });
    if (selector.strategy === 'placeholder') return page.getByPlaceholder(selector.text, { exact: selector.exact });
    if (selector.strategy === 'text') return page.getByText(selector.text, { exact: selector.exact });
    if (selector.strategy === 'text_any') return page.getByText(new RegExp(selector.texts.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), selector.exact ? undefined : 'i')).first();
    if (selector.strategy === 'semantic') return this.toLocator(page, selector.candidates[0]!);
    if (selector.strategy === 'index') return this.toLocator(page, selector.target).nth(selector.index);
    if (selector.strategy === 'document') return page.locator('html');
    return page.getByTestId(selector.value);
  }
}
