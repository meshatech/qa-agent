import { Injectable } from '@nestjs/common';
import type { BugCategory, BugClassification, BugSignalType } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

const DEFAULT_NOISE_REGEXES: RegExp[] = [
  /ResizeObserver loop limit exceeded/i,
  /ResizeObserver loop completed with undelivered notifications/i,
  /Non-Error promise rejection captured/i,
  /favicon\.ico.*404/i,
  /Loading chunk \d+ failed/i,
  /Failed to register a ServiceWorker/i,
  /the connection is being closed/i,
  /Script error\.?$/i,
];

const DEFAULT_TRACKING_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.net',
  'connect.facebook.net',
  'hotjar.com',
  'segment.io',
  'segment.com',
  'clarity.ms',
  'mixpanel.com',
  'sentry.io',
  'newrelic.com',
];

const DEPRECATION_PATTERNS: RegExp[] = [
  /deprecat/i,
  /will be removed in/i,
  /no longer supported/i,
];

const VISUAL_BROKEN_PATTERNS: RegExp[] = [
  /layout/i,
  /viewport/i,
  /overflow/i,
];

@Injectable()
export class BugClassifierService {
  classify(input: { signalType: BugSignalType; message: string; source?: string; status?: number; level?: string; config: RunConfig }): BugClassification {
    const message = input.message ?? '';

    if (this.matchesNoise(message, input.config)) return this.noise('THIRD_PARTY_NOISE', 'matched configured/default noise regex');
    if (this.isExtension(input.source)) return this.noise('BROWSER_EXTENSION_NOISE', 'browser extension origin');
    if (this.isTracking(input.source, input.config)) return this.noise('TRACKING_NOISE', `tracking endpoint ${input.source ?? ''}`);
    if (this.isThirdPartyConfigured(input.source, input.config)) return this.noise('THIRD_PARTY_NOISE', 'configured third-party domain');

    if (input.signalType === 'DEPRECATION_WARNING' || (input.level === 'warning' && DEPRECATION_PATTERNS.some((re) => re.test(message)))) {
      return { isBug: false, severity: 'LOW', category: 'DEPRECATION_WARNING', reason: 'deprecation/warning message' };
    }

    const isApp = this.isApp(input.source, input.config.appDomains);

    switch (input.signalType) {
      case 'APP_NETWORK_5XX': {
        if (!isApp) return input.config.classifier.treatThirdPartyNetwork5xxAsBug
          ? this.bug('APP_FAULT', 'MEDIUM', `third-party 5xx: ${message}`)
          : this.noise('THIRD_PARTY_NOISE', `third-party 5xx ${message}`);
        return this.bug('APP_FAULT', 'CRITICAL', message || `app 5xx (${input.status ?? 'unknown'})`);
      }
      case 'APP_NETWORK_4XX_UNEXPECTED': {
        if (!isApp) return this.noise('THIRD_PARTY_NOISE', `third-party 4xx ${message}`);
        const status = input.status ?? 400;
        if (status === 401 || status === 403) return this.bug('APP_FAULT', 'HIGH', `auth ${status}: ${message}`);
        if (status === 404) return this.bug('APP_FAULT', 'MEDIUM', `not found 404: ${message}`);
        if (status === 408 || status === 429) return this.bug('APP_FAULT', 'MEDIUM', `transient ${status}: ${message}`);
        return this.bug('APP_FAULT', 'HIGH', `app ${status}: ${message}`);
      }
      case 'THIRD_PARTY_NETWORK_FAILURE':
        return this.noise('THIRD_PARTY_NOISE', message);
      case 'APP_CONSOLE_EXCEPTION':
        return isApp ? this.bug('APP_FAULT', 'HIGH', message) : this.noise('THIRD_PARTY_NOISE', message);
      case 'NAVIGATION_UNEXPECTED':
        return this.bug('NAVIGATION_FAULT', 'HIGH', message);
      case 'ASSERTION_FAILURE':
        return this.bug('ASSERTION_FAULT', 'HIGH', message);
      case 'LOADING_STUCK':
        return this.bug('APP_FAULT', 'HIGH', message || 'loading infinito');
      case 'TIMEOUT':
        return this.bug('APP_FAULT', 'MEDIUM', message || 'timeout em ação crítica');
      case 'VISUAL_BROKEN':
        return this.bug('APP_FAULT', 'MEDIUM', message || 'layout quebrado');
      case 'TRACKING_ERROR':
        return this.noise('TRACKING_NOISE', message || 'tracking failure');
      default:
        return this.bug('APP_FAULT', 'MEDIUM', message || 'unclassified bug');
    }
  }

  isAppOrigin(source: string | undefined, domains: string[]): boolean {
    return this.isApp(source, domains);
  }

  private matchesNoise(message: string, config: RunConfig): boolean {
    if (!message) return false;
    const configured = config.classifier.knownNoiseRegexes ?? [];
    if (configured.some((src) => new RegExp(src, 'i').test(message))) return true;
    if (DEFAULT_NOISE_REGEXES.some((re) => re.test(message))) return true;
    if (VISUAL_BROKEN_PATTERNS.some((re) => re.test(message))) return false;
    return false;
  }

  private isExtension(source: string | undefined): boolean {
    if (!source) return false;
    return /^(chrome-extension|moz-extension|webkit-extension|safari-extension):/.test(source);
  }

  private isTracking(source: string | undefined, config: RunConfig): boolean {
    if (!source) return false;
    const host = this.host(source);
    const configured = config.classifier.knownTrackingDomains ?? [];
    if (configured.some((d) => host === d || host.endsWith(`.${d}`))) return true;
    return DEFAULT_TRACKING_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  }

  private isThirdPartyConfigured(source: string | undefined, config: RunConfig): boolean {
    if (!source) return false;
    const list = config.classifier.knownThirdPartyDomains ?? [];
    if (!list.length) return false;
    return list.some((d) => source.includes(d));
  }

  private isApp(source: string | undefined, domains: string[]): boolean {
    if (!source) return true;
    const host = this.host(source);
    if (!host) return false;
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  }

  private host(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  private bug(category: BugCategory, severity: BugClassification['severity'], reason: string): BugClassification {
    return { isBug: true, category, severity, reason };
  }

  private noise(category: BugCategory, reason: string): BugClassification {
    return { isBug: false, category, severity: 'LOW', reason };
  }
}
