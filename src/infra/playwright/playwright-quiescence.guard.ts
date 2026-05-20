import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import type { QuiescenceResult } from '../../domain/models/run.model.js';

@Injectable()
export class PlaywrightQuiescenceGuard {
  async wait(page: Page, timeoutMs: number): Promise<QuiescenceResult> {
    const started = Date.now();
    let networkIdle = false;
    try {
      await page.waitForLoadState('networkidle', { timeout: timeoutMs });
      networkIdle = true;
    } catch {
      // DOM quiet can still be enough for SPAs with long polling.
    }
    try {
      await page.evaluate(
        ({ quietMs, timeoutMs }) => new Promise<void>((resolve, reject) => {
          let quietTimer: number;
          const observer = new MutationObserver(() => {
            window.clearTimeout(quietTimer);
            quietTimer = window.setTimeout(done, quietMs);
          });
          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error('DOM quiet timeout'));
          }, timeoutMs);
          function done() {
            window.clearTimeout(timeout);
            observer.disconnect();
            resolve();
          }
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          quietTimer = window.setTimeout(done, quietMs);
        }),
        { quietMs: 250, timeoutMs },
      );
      return { stable: true, reason: networkIdle ? 'NETWORK_AND_DOM_IDLE' : 'DOM_IDLE_ONLY', elapsedMs: Date.now() - started };
    } catch {
      const elapsedMs = Date.now() - started;
      if (elapsedMs < timeoutMs) {
        await page.waitForTimeout(250).catch(() => undefined);
        return { stable: true, reason: networkIdle ? 'NETWORK_AND_DOM_IDLE' : 'DOM_IDLE_ONLY', elapsedMs: Date.now() - started };
      }
      return { stable: false, reason: 'TIMEOUT_BUT_CONTINUABLE', elapsedMs };
    }
  }
}
