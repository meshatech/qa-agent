import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { PageStateDetector } from '../src/infra/observation/page-state.detector.js';

describe('PageStateDetector', () => {
  it('returns a neutral state when page is already closed', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<div class="loading"></div>');
    await page.close();

    const state = await new PageStateDetector().detect(page);

    expect(state).toMatchObject({
      isLoading: false,
      hasModal: false,
      hasToast: false,
      hasValidationErrors: false,
      hasOverlay: false,
    });
    await browser.close();
  }, 30000);
});
