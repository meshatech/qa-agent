import { Injectable } from '@nestjs/common';
import type { Page, Locator } from 'playwright';
import { HarnessFatalError } from '../../../domain/errors.js';
import type { LocatorDescriptor } from '../../../domain/schemas/action.schema.js';
import type { RunConfig } from '../../../domain/schemas/config.schema.js';

interface FormLoginAuth {
  kind: 'formLogin';
  loginUrl: string;
  usernameSelector: string | LocatorDescriptor;
  passwordSelector: string | LocatorDescriptor;
  submitSelector: string | LocatorDescriptor;
  usernameEnv: string;
  passwordEnv: string;
  successUrlContains?: string;
  successWhen?: { urlContains?: string; textVisible?: string };
  errorTextSelector?: string;
  maxRetries: number;
}

@Injectable()
export class FormLoginService {
  async login(page: Page, config: RunConfig): Promise<void> {
    if (config.auth.kind !== 'formLogin') return;
    const auth = config.auth as FormLoginAuth;
    const username = process.env[auth.usernameEnv];
    const password = process.env[auth.passwordEnv];
    if (!username) throw new HarnessFatalError(`Missing env ${auth.usernameEnv} for formLogin`);
    if (!password) throw new HarnessFatalError(`Missing env ${auth.passwordEnv} for formLogin`);

    let lastError: unknown;
    for (let attempt = 0; attempt <= auth.maxRetries; attempt++) {
      try {
        await this.attemptLogin(page, auth, username, password, config);
        return;
      } catch (error) {
        lastError = error;
        if (attempt === auth.maxRetries) break;
        await page.waitForTimeout(500).catch(() => undefined);
      }
    }
    throw lastError instanceof Error ? new HarnessFatalError(`Form login failed: ${lastError.message}`, lastError) : new HarnessFatalError('Form login failed: unknown', lastError);
  }

  private async attemptLogin(page: Page, auth: FormLoginAuth, username: string, password: string, config: RunConfig): Promise<void> {
    const loginUrl = new URL(auth.loginUrl, config.baseUrl).toString();
    await page.goto(loginUrl, { timeout: config.timeouts.navigationMs });

    const usernameLocator = this.toLocator(page, auth.usernameSelector);
    const passwordLocator = this.toLocator(page, auth.passwordSelector);
    const submitLocator = this.toLocator(page, auth.submitSelector);

    await usernameLocator.waitFor({ state: 'visible', timeout: config.timeouts.actionMs });
    await usernameLocator.fill(username);
    await passwordLocator.waitFor({ state: 'visible', timeout: config.timeouts.actionMs });
    await passwordLocator.fill(password);
    await submitLocator.click();

    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: config.timeouts.navigationMs }).catch(() => undefined),
      page.waitForTimeout(config.timeouts.navigationMs),
    ]);

    if (auth.errorTextSelector) {
      const errorVisible = await page.locator(auth.errorTextSelector).isVisible().catch(() => false);
      if (errorVisible) {
        const text = await page.locator(auth.errorTextSelector).innerText().catch(() => 'login error');
        throw new HarnessFatalError(`Login error displayed: ${text.slice(0, 120)}`);
      }
    }

    const success = auth.successWhen ?? (auth.successUrlContains ? { urlContains: auth.successUrlContains } : undefined);
    if (!success) return;

    if (success.urlContains) {
      await page.waitForURL((url) => url.toString().includes(success.urlContains!), { timeout: config.timeouts.navigationMs });
    }
    if (success.textVisible) {
      await page.getByText(success.textVisible).first().waitFor({ state: 'visible', timeout: config.timeouts.actionMs });
    }
  }

  private toLocator(page: Page, selector: string | LocatorDescriptor): Locator {
    if (typeof selector === 'string') return page.locator(selector);
    if (selector.strategy === 'role') return page.getByRole(selector.role as Parameters<Page['getByRole']>[0], { name: selector.name, exact: selector.exact });
    if (selector.strategy === 'label') return page.getByLabel(selector.text, { exact: selector.exact });
    if (selector.strategy === 'placeholder') return page.getByPlaceholder(selector.text, { exact: selector.exact });
    if (selector.strategy === 'text') return page.getByText(selector.text, { exact: selector.exact });
    return page.getByTestId(selector.value);
  }
}
