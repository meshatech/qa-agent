import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

export interface ConsoleSignal {
  level: string;
  text: string;
  source?: string;
  isAppOrigin: boolean;
  timestamp: string;
}

export interface NetworkSignal {
  method: string;
  url: string;
  status: number;
  failure?: string;
  isAppOrigin: boolean;
  durationMs?: number;
  headers?: Record<string, string>;
  resourceType?: string;
  timestamp: string;
}

export interface SignalsBuffer {
  console: ConsoleSignal[];
  network: NetworkSignal[];
  reset(): void;
}

const TRACKING_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.net',
  'hotjar.com',
  'segment.io',
  'segment.com',
  'clarity.ms',
  'mixpanel.com',
  'omnitagjs.com',
  'doubleclick.net',
  'googlesyndication.com',
  'adsafeprotected.com',
  'prebid',
  'moatads.com',
  'amazon-adsystem.com',
  'outbrain.com',
  'taboola.com',
];

@Injectable()
export class SignalsCollector {
  attach(page: Page, config: RunConfig, buffer: SignalsBuffer): void {
    page.on('console', (msg) => {
      const location = msg.location();
      const source = location.url || undefined;
      buffer.console.push({
        level: msg.type(),
        text: msg.text(),
        source,
        isAppOrigin: this.isApp(source, config.appDomains),
        timestamp: new Date().toISOString(),
      });
      if (buffer.console.length > 200) buffer.console.shift();
    });

    page.on('pageerror', (error) => {
      buffer.console.push({
        level: 'error',
        text: error.message,
        source: undefined,
        isAppOrigin: false,
        timestamp: new Date().toISOString(),
      });
      if (buffer.console.length > 200) buffer.console.shift();
    });

    page.on('response', (res) => {
      const url = res.url();
      const host = this.host(url);
      buffer.network.push({
        method: res.request().method(),
        url,
        status: res.status(),
        headers: res.headers(),
        resourceType: res.request().resourceType(),
        isAppOrigin: this.isApp(url, config.appDomains),
        timestamp: new Date().toISOString(),
        durationMs: undefined,
      });
      if (buffer.network.length > 500) buffer.network.shift();
      void host;
    });

    page.on('requestfailed', (req) => {
      buffer.network.push({
        method: req.method(),
        url: req.url(),
        status: 0,
        failure: req.failure()?.errorText,
        resourceType: req.resourceType(),
        isAppOrigin: this.isApp(req.url(), config.appDomains),
        timestamp: new Date().toISOString(),
      });
      if (buffer.network.length > 500) buffer.network.shift();
    });
  }

  createBuffer(): SignalsBuffer {
    const buf: SignalsBuffer = {
      console: [],
      network: [],
      reset() {
        this.console.length = 0;
        this.network.length = 0;
      },
    };
    return buf;
  }

  isTrackingHost(url: string | undefined): boolean {
    if (!url) return false;
    const host = this.host(url);
    return TRACKING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  }

  private isApp(url: string | undefined, domains: string[]): boolean {
    if (!url) return false;
    const host = this.host(url);
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  }

  private host(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }
}
