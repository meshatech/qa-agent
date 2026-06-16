import { describe, expect, it } from 'vitest';
import { BugClassifierService } from '../src/application/services/bug-classifier.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { BugSignalType } from '../src/domain/models/run.model.js';

const config = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D', title: 'T', description: 'D' },
  classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], knownThirdPartyDomains: [] },
});

function classify(signalType: BugSignalType, message: string, source?: string, status?: number, level?: string) {
  const service = new BugClassifierService();
  return service.classify({ signalType, message, source, status, level, config });
}

describe('BugClassifierService', () => {
  it('classifies app 5xx as critical bug', () => {
    const result = classify('APP_NETWORK_5XX', 'Internal Server Error', 'https://app.local/api', 500);
    expect(result.isBug).toBe(true);
    expect(result.severity).toBe('CRITICAL');
    expect(result.category).toBe('APP_FAULT');
  });

  it('classifies third-party 5xx as noise by default', () => {
    const result = classify('APP_NETWORK_5XX', 'Internal Server Error', 'https://third-party.com/api', 500);
    expect(result.isBug).toBe(false);
    expect(result.category).toBe('THIRD_PARTY_NOISE');
  });

  it('classifies app console exception as HIGH bug', () => {
    const result = classify('APP_CONSOLE_EXCEPTION', 'TypeError: cannot read property', 'https://app.local/main.js');
    expect(result.isBug).toBe(true);
    expect(result.severity).toBe('HIGH');
  });

  it('classifies third-party console exception from tracking domain as noise', () => {
    const result = classify('APP_CONSOLE_EXCEPTION', 'Error in tracking script', 'https://google-analytics.com/g.js');
    expect(result.isBug).toBe(false);
    expect(result.category).toBe('TRACKING_NOISE');
  });

  it('classifies navigation fault as HIGH bug', () => {
    const result = classify('NAVIGATION_UNEXPECTED', 'Unexpected redirect to error page');
    expect(result.isBug).toBe(true);
    expect(result.category).toBe('NAVIGATION_FAULT');
  });

  it('classifies assertion failure as HIGH bug', () => {
    const result = classify('ASSERTION_FAILURE', 'Expected element not visible');
    expect(result.isBug).toBe(true);
    expect(result.category).toBe('ASSERTION_FAULT');
  });

  it('classifies timeout as MEDIUM bug', () => {
    const result = classify('TIMEOUT', 'Action timed out after 30000ms');
    expect(result.isBug).toBe(true);
    expect(result.severity).toBe('MEDIUM');
  });

  it('classifies tracking error as noise', () => {
    const result = classify('TRACKING_ERROR', 'Segment failed to load');
    expect(result.isBug).toBe(false);
    expect(result.category).toBe('TRACKING_NOISE');
  });

  it('classifies loading stuck as HIGH bug', () => {
    const result = classify('LOADING_STUCK', 'Page stuck loading');
    expect(result.isBug).toBe(true);
    expect(result.severity).toBe('HIGH');
  });

  it('classifies visual broken as MEDIUM bug', () => {
    const result = classify('VISUAL_BROKEN', 'Layout overflow detected');
    expect(result.isBug).toBe(true);
    expect(result.severity).toBe('MEDIUM');
  });

  it('treats browser extension as noise', () => {
    const result = classify('APP_CONSOLE_EXCEPTION', 'Some error', 'chrome-extension://abc');
    expect(result.isBug).toBe(false);
    expect(result.category).toBe('BROWSER_EXTENSION_NOISE');
  });

  it('matches configured noise regex', () => {
    const customConfig = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      classifier: { knownNoiseRegexes: ['custom noise'], knownTrackingDomains: [], knownThirdPartyDomains: [] },
    });
    const service = new BugClassifierService();
    const result = service.classify({ signalType: 'APP_CONSOLE_EXCEPTION', message: 'This is a custom noise message', source: 'https://app.local/main.js', config: customConfig });
    expect(result.isBug).toBe(false);
    expect(result.category).toBe('THIRD_PARTY_NOISE');
  });

  it('classifies 401/403 as HIGH auth bug', () => {
    const r401 = classify('APP_NETWORK_4XX_UNEXPECTED', 'Unauthorized', 'https://app.local/api', 401);
    expect(r401.isBug).toBe(true);
    expect(r401.severity).toBe('HIGH');

    const r403 = classify('APP_NETWORK_4XX_UNEXPECTED', 'Forbidden', 'https://app.local/api', 403);
    expect(r403.isBug).toBe(true);
    expect(r403.severity).toBe('HIGH');
  });

  it('classifies 404 as MEDIUM bug', () => {
    const result = classify('APP_NETWORK_4XX_UNEXPECTED', 'Not found', 'https://app.local/api', 404);
    expect(result.isBug).toBe(true);
    expect(result.severity).toBe('MEDIUM');
  });

  it('classifies deprecation warnings as non-bug LOW', () => {
    const result = classify('DEPRECATION_WARNING', 'This API is deprecated');
    expect(result.isBug).toBe(false);
    expect(result.severity).toBe('LOW');
  });

  it('classifies unknown signal type as MEDIUM bug', () => {
    const result = classify('UNKNOWN_SIGNAL' as BugSignalType, 'Something happened');
    expect(result.isBug).toBe(true);
    expect(result.severity).toBe('MEDIUM');
  });
});
