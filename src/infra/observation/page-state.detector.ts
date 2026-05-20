import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';

export interface PageState {
  isLoading: boolean;
  hasModal: boolean;
  hasToast: boolean;
  hasValidationErrors: boolean;
  hasOverlay: boolean;
  focusedElementName?: string;
}

@Injectable()
export class PageStateDetector {
  async detect(page: Page): Promise<PageState> {
    const [isLoading, hasModal, hasToast, hasValidationErrors, hasOverlay, focusedElementName] = await Promise.all([
      this.has(page, '[aria-busy=true], [data-loading=true], .loading, .spinner, .skeleton'),
      this.has(page, '[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true]'),
      this.has(page, '[role=status], [role=alert], .toast, .notification'),
      this.has(page, '[aria-invalid=true], [role=alert], .field-error, .error-message'),
      this.has(page, '[role=presentation][aria-hidden=false], .overlay, [data-overlay=true], .backdrop, .modal-backdrop'),
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return undefined;
        const labels = (el as HTMLInputElement).labels;
        return el.getAttribute('aria-label') ?? labels?.[0]?.textContent?.trim() ?? (el as HTMLInputElement).placeholder ?? el.textContent?.trim()?.slice(0, 60) ?? undefined;
      }).catch(() => undefined),
    ]);
    return { isLoading, hasModal, hasToast, hasValidationErrors, hasOverlay, focusedElementName };
  }

  private async has(page: Page, selector: string): Promise<boolean> {
    if (page.isClosed()) return false;
    return page.locator(selector).count().then((n) => n > 0).catch(() => false);
  }
}
