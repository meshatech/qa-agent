import { Inject, Injectable } from '@nestjs/common';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import { DeepThinkService } from './deep-think.service.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { QaAction } from '../../domain/schemas/action.schema.js';

export interface MonitorState {
  url: string;
  title: string;
  isLoading: boolean;
  elementCount: number;
  visibleTexts: string[];
  timestamp: number;
  actionInProgress: boolean;
}

export interface MonitorAction {
  type: 'THINK' | 'WAIT' | 'RETRY' | 'ESCAPE' | 'NAVIGATE' | 'SCREENSHOT';
  reason: string;
  action?: QaAction;
}

@Injectable()
export class ExecutionMonitorService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private history: MonitorState[] = [];
  private maxHistory = 20;
  private running = false;
  private currentStepDescription = '';
  private lastActionTime = 0;
  private lastCorrectiveActionType = '';
  private consecutiveCorrectiveCount = 0;
  private readonly maxConsecutiveSameAction = 3;

  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject(DeepThinkService) private readonly deepThink: DeepThinkService,
  ) {}

  start(config: RunConfig): void {
    if (this.running) return;
    if (config.monitor?.enabled === false) {
      console.log('[MONITOR] Background monitor disabled by config');
      return;
    }
    this.running = true;
    this.history = [];
    this.lastActionTime = Date.now();
    this.lastCorrectiveActionType = '';
    this.consecutiveCorrectiveCount = 0;

    const intervalMs = config.monitor?.checkIntervalMs ?? (config.timeouts?.quiescenceMs ? Math.min(config.timeouts.quiescenceMs / 3, 5000) : 3000);

    this.timer = setInterval(() => {
      this.tick(config).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('closed') && !msg.includes('detached')) {
          console.log(`[MONITOR] Background check error: ${msg.slice(0, 80)}`);
        }
      });
    }, intervalMs);

    console.log(`[MONITOR] Background thinking started (interval: ${intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.history = [];
    console.log('[MONITOR] Background thinking stopped');
  }

  setStepDescription(description: string): void {
    this.currentStepDescription = description;
  }

  markActionStarted(): void {
    this.lastActionTime = Date.now();
  }

  private async tick(config: RunConfig): Promise<void> {
    if (!this.running) return;

    let obs: ScreenObservation;
    try {
      obs = await this.browser.observe();
    } catch {
      return;
    }

    const state: MonitorState = {
      url: obs.url,
      title: obs.title,
      isLoading: obs.pageState.isLoading,
      elementCount: obs.elements.length,
      visibleTexts: obs.visibleTexts,
      timestamp: Date.now(),
      actionInProgress: Date.now() - this.lastActionTime < 2000,
    };

    this.history.push(state);
    if (this.history.length > this.maxHistory) this.history.shift();

    const diagnosis = this.diagnose(state, config);
    if (!diagnosis) return;

    let actionType = diagnosis.type;
    let actionReason = diagnosis.reason;
    let actionToExecute = diagnosis.action;

    if (actionToExecute) {
      if (actionType === this.lastCorrectiveActionType) {
        this.consecutiveCorrectiveCount += 1;
      } else {
        this.lastCorrectiveActionType = actionType;
        this.consecutiveCorrectiveCount = 1;
      }

      if (this.consecutiveCorrectiveCount >= this.maxConsecutiveSameAction) {
        console.log(`[MONITOR] Same corrective action (${actionType}) repeated ${this.consecutiveCorrectiveCount} times. Switching to THINK.`);
        actionType = 'THINK';
        actionReason = `Repeated ${diagnosis.type} ${this.consecutiveCorrectiveCount} times without progress.`;
        actionToExecute = undefined;
      }
    }

    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║          👁️  MONITOR DETECTED: ${actionType.padEnd(25)}║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝`);
    console.log(`> URL: ${state.url}`);
    console.log(`> Loading: ${state.isLoading}`);
    console.log(`> Elements: ${state.elementCount}`);
    console.log(`> Reason: ${actionReason}`);
    console.log('');

    if (actionToExecute) {
      console.log(`[MONITOR] Executing corrective action: ${actionType}`);
      try {
        await this.browser.execute(actionToExecute);
        this.lastActionTime = Date.now();
        console.log(`[MONITOR] Corrective action succeeded`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[MONITOR] Corrective action failed: ${msg.slice(0, 80)}`);
      }
    } else if (actionType !== 'WAIT') {
      this.lastActionTime = Date.now();
    }
  }

  private diagnose(current: MonitorState, config: RunConfig): MonitorAction | null {
    if (current.actionInProgress) return null;
    if (this.history.length < 3) return null;

    const recent = this.history.slice(-5);
    const urls = recent.map((s) => s.url);
    const allSameUrl = urls.every((u) => u === current.url);
    const anyLoading = recent.some((s) => s.isLoading);
    const timeSinceLastAction = Date.now() - this.lastActionTime;

    const navigationTimeout = config.timeouts?.navigationMs ?? 15000;
    const actionTimeout = config.timeouts?.actionMs ?? 15000;

    // Detect SPA progress: title changed or visible texts changed or element count changed
    const isMakingProgress = this.detectProgress(current, recent);
    if (isMakingProgress) return null;

    if (allSameUrl && timeSinceLastAction > navigationTimeout && current.isLoading) {
      return {
        type: 'THINK',
        reason: `Page stuck loading for ${timeSinceLastAction}ms at ${current.url}`,
      };
    }

    if (allSameUrl && timeSinceLastAction > actionTimeout * 1.5 && !current.isLoading) {
      const interactiveCount = current.elementCount;
      if (interactiveCount === 0) {
        return {
          type: 'THINK',
          reason: `No interactive elements visible for ${timeSinceLastAction}ms. Page may be blank or blocked.`,
        };
      }

      // Do NOT press Escape on known editor/SPA sites — it's destructive
      if (this.isEditorOrRichTextSite(current.url)) {
        return {
          type: 'THINK',
          reason: `Stalled for ${timeSinceLastAction}ms on editor/SPA site (${current.url}). Escaping would be destructive.`,
        };
      }

      return {
        type: 'ESCAPE',
        reason: `Stalled for ${timeSinceLastAction}ms. Attempting Escape key to dismiss overlays.`,
        action: { type: 'press', key: 'Escape', reason: 'Monitor: dismiss potential overlay/blocker' },
      };
    }

    if (current.url.includes('authFailure') || current.url.includes('error') || current.url.includes('fail')) {
      return {
        type: 'THINK',
        reason: `URL contains error indicator: ${current.url}`,
      };
    }

    if (anyLoading && timeSinceLastAction > navigationTimeout / 2) {
      return {
        type: 'WAIT',
        reason: `Page still loading after ${timeSinceLastAction}ms. Will continue monitoring.`,
      };
    }

    return null;
  }

  private detectProgress(current: MonitorState, recent: MonitorState[]): boolean {
    if (recent.length < 2) return false;
    const prev = recent[recent.length - 2];
    if (prev.title !== current.title) return true;
    if (prev.elementCount !== current.elementCount) return true;
    // Compare visible texts (hash-like check)
    const prevTexts = prev.visibleTexts.join('|');
    const currTexts = current.visibleTexts.join('|');
    if (prevTexts !== currTexts && current.visibleTexts.length > 0) return true;
    return false;
  }

  private isEditorOrRichTextSite(url: string): boolean {
    const hosts = [
      'codeshare.io',
      'codepen.io',
      'jsfiddle.net',
      'jsbin.com',
      'replit.com',
      'stackblitz.com',
      'glitch.com',
      'gitlab.com',
      'github.dev',
      'vscode.dev',
      'notion.so',
      'docs.google.com',
      'sheets.google.com',
      'excalidraw.com',
      'draw.io',
      'diagrams.net',
      'figma.com',
      'miro.com',
      'trello.com',
    ];
    try {
      const hostname = new URL(url).hostname;
      return hosts.some((h) => hostname === h || hostname.endsWith('.' + h));
    } catch {
      return false;
    }
  }
}
