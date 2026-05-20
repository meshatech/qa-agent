import { describe, expect, it } from 'vitest';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const config = RunConfigSchema.parse({
  baseUrl: 'http://127.0.0.1',
  appDomains: ['127.0.0.1'],
  demand: { id: 'D', title: 'T', description: 'D' },
  allowedRoutes: ['/safe'],
});

describe('ActionPolicyService', () => {
  it('blocks navigation outside allowed routes', () => {
    const result = new ActionPolicyService().validate({ type: 'navigate', to: '/admin', reason: 'test' }, config, []);
    expect(result.ok).toBe(false);
  });

  it('blocks coordinates before semantic failures', () => {
    const result = new ActionPolicyService().validate({ type: 'clickAtCoordinates', x: 1, y: 1, risk: 'HIGH', reason: 'last resort click' }, config, []);
    expect(result.ok).toBe(false);
  });
});
