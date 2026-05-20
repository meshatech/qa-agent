import { describe, expect, it } from 'vitest';
import { BugClassifierService } from '../src/application/services/bug-classifier.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const config = RunConfigSchema.parse({
  baseUrl: 'http://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D', title: 'T', description: 'D' },
});

const classifier = new BugClassifierService();

describe('BugClassifierService extra heuristics', () => {
  it('classifies tracking domains as TRACKING_NOISE', () => {
    const c = classifier.classify({ signalType: 'APP_CONSOLE_EXCEPTION', message: 'fail', source: 'https://www.google-analytics.com/collect', config });
    expect(c.isBug).toBe(false);
    expect(c.category).toBe('TRACKING_NOISE');
  });

  it('classifies ResizeObserver loop as default noise', () => {
    const c = classifier.classify({ signalType: 'APP_CONSOLE_EXCEPTION', message: 'ResizeObserver loop limit exceeded', source: 'http://app.local/x', config });
    expect(c.isBug).toBe(false);
    expect(c.category).toBe('THIRD_PARTY_NOISE');
  });

  it('app 401/403 → HIGH', () => {
    const c = classifier.classify({ signalType: 'APP_NETWORK_4XX_UNEXPECTED', message: 'unauthorized', source: 'http://app.local/api', status: 401, config });
    expect(c.isBug).toBe(true);
    expect(c.severity).toBe('HIGH');
  });

  it('app 404 → MEDIUM', () => {
    const c = classifier.classify({ signalType: 'APP_NETWORK_4XX_UNEXPECTED', message: 'not found', source: 'http://app.local/api', status: 404, config });
    expect(c.isBug).toBe(true);
    expect(c.severity).toBe('MEDIUM');
  });

  it('app 5xx → CRITICAL', () => {
    const c = classifier.classify({ signalType: 'APP_NETWORK_5XX', message: '500', source: 'http://app.local/api', status: 500, config });
    expect(c.isBug).toBe(true);
    expect(c.severity).toBe('CRITICAL');
  });

  it('third-party 5xx → noise unless treatThirdPartyNetwork5xxAsBug', () => {
    const c = classifier.classify({ signalType: 'APP_NETWORK_5XX', message: '500', source: 'https://other.com/api', status: 500, config });
    expect(c.isBug).toBe(false);
  });

  it('deprecation warning → DEPRECATION_WARNING noise', () => {
    const c = classifier.classify({ signalType: 'DEPRECATION_WARNING', message: 'X is deprecated', source: 'http://app.local/x', level: 'warning', config });
    expect(c.isBug).toBe(false);
    expect(c.category).toBe('DEPRECATION_WARNING');
  });

  it('LOADING_STUCK → APP_FAULT HIGH', () => {
    const c = classifier.classify({ signalType: 'LOADING_STUCK', message: 'spinner travado', config });
    expect(c.isBug).toBe(true);
    expect(c.severity).toBe('HIGH');
  });

  it('VISUAL_BROKEN → APP_FAULT MEDIUM', () => {
    const c = classifier.classify({ signalType: 'VISUAL_BROKEN', message: 'overflow inesperado', config });
    expect(c.isBug).toBe(true);
    expect(c.severity).toBe('MEDIUM');
  });

  it('TIMEOUT → APP_FAULT MEDIUM', () => {
    const c = classifier.classify({ signalType: 'TIMEOUT', message: 'click timeout', config });
    expect(c.isBug).toBe(true);
    expect(c.severity).toBe('MEDIUM');
  });

  it('NAVIGATION_UNEXPECTED → NAVIGATION_FAULT HIGH', () => {
    const c = classifier.classify({ signalType: 'NAVIGATION_UNEXPECTED', message: '/login redirect', config });
    expect(c.isBug).toBe(true);
    expect(c.category).toBe('NAVIGATION_FAULT');
  });
});
