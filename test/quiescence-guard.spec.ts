import { describe, expect, it } from 'vitest';
import { launchBrowser } from './helpers/playwright-launch.js';
import { PlaywrightQuiescenceGuard } from '../src/infra/playwright/playwright-quiescence.guard.js';

describe('PlaywrightQuiescenceGuard', () => {
  it('returns a structured result', async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent('<main>ok</main>');
    const result = await new PlaywrightQuiescenceGuard().wait(page, 1000);
    await browser.close();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(['NETWORK_AND_DOM_IDLE', 'DOM_IDLE_ONLY', 'TIMEOUT_BUT_CONTINUABLE']).toContain(result.reason);
  }, 15000);

  it('does not leak observer temporal-dead-zone errors to the page', async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.setContent('<main><div class="loading">loading</div></main>');
    await new PlaywrightQuiescenceGuard().wait(page, 1);
    await browser.close();
    expect(errors.join(' | ')).not.toContain("Cannot access 'observer' before initialization");
  }, 15000);
});
