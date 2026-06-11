import { describe, expect, it } from 'vitest';
import { NetworkStateValidatorService } from '../src/application/services/network-state-validator.service.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';

function makeObs(networkSignals: ScreenObservation['networkSignals']): ScreenObservation {
  return {
    observationId: 'obs_1',
    createdAt: new Date().toISOString(),
    url: 'https://app.local/dashboard',
    title: 'Dashboard',
    visibleTexts: [],
    elements: [],
    networkSignals,
    pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
    consoleSignals: [],
    meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
  };
}

const ts = new Date().toISOString();
const baseObs = makeObs([
  { url: 'https://app.local/api/users', method: 'GET', status: 200, isAppOrigin: true, timestamp: ts },
  { url: 'https://app.local/api/data', method: 'POST', status: 500, isAppOrigin: true, timestamp: ts },
  { url: 'https://third-party.com/track', method: 'GET', status: 404, isAppOrigin: false, timestamp: ts },
]);

const makeService = () => new NetworkStateValidatorService();

describe('NetworkStateValidatorService', () => {
  it('returns undefined for non-network_state conditions', () => {
    const service = makeService();
    const result = service.validate({ type: 'no_console_errors' } as unknown as import('../src/domain/schemas/execution-plan.schema.js').PlanCondition, baseObs);
    expect(result).toBeUndefined();
  });

  it('passes no_errors when all app requests succeed', () => {
    const service = makeService();
    const obs = makeObs([{ url: 'https://app.local/api/users', method: 'GET', status: 200, isAppOrigin: true, timestamp: ts }]);
    const result = service.validate({ type: 'network_state', expected: 'no_errors' }, obs);
    expect(result?.ok).toBe(true);
  });

  it('fails no_errors when there is a 5xx', () => {
    const service = makeService();
    const result = service.validate({ type: 'network_state', expected: 'no_errors' }, baseObs);
    expect(result?.ok).toBe(false);
    expect(result?.actual).toContain('500');
  });

  it('ignores non-app-origin signals', () => {
    const service = makeService();
    const obs = makeObs([{ url: 'https://third-party.com/track', method: 'GET', status: 404, isAppOrigin: false, timestamp: ts }]);
    const result = service.validate({ type: 'network_state', expected: 'no_errors' }, obs);
    expect(result?.ok).toBe(true);
  });

  it('passes no_5xx when no 5xx app requests', () => {
    const service = makeService();
    const obs = makeObs([{ url: 'https://app.local/api/users', method: 'GET', status: 404, isAppOrigin: true, timestamp: ts }]);
    const result = service.validate({ type: 'network_state', expected: 'no_5xx' }, obs);
    expect(result?.ok).toBe(true);
  });

  it('fails no_5xx when there is a 5xx', () => {
    const service = makeService();
    const result = service.validate({ type: 'network_state', expected: 'no_5xx' }, baseObs);
    expect(result?.ok).toBe(false);
  });

  it('passes has_request_to when matching url found', () => {
    const service = makeService();
    const obs = makeObs([{ url: 'https://app.local/api/logout', method: 'POST', status: 200, isAppOrigin: true, timestamp: ts }]);
    const result = service.validate({ type: 'network_state', expected: 'has_request_to', urlPattern: '/api/logout' }, obs);
    expect(result?.ok).toBe(true);
  });

  it('fails has_request_to when urlPattern missing', () => {
    const service = makeService();
    const result = service.validate({ type: 'network_state', expected: 'has_request_to' }, baseObs);
    expect(result?.ok).toBe(false);
    expect(result?.actual).toBe('urlPattern missing');
  });
});
