import { describe, expect, it } from 'vitest';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const baseConfig = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D', title: 'T', description: 'D' },
  runtime: { destructiveActionPolicy: 'BLOCK' },
});

describe('ActionPolicyService', () => {
  const service = new ActionPolicyService();

  it('allows actions by default', () => {
    const result = service.validate({ type: 'click', targetElementId: 'el_001', reason: 'test' }, baseConfig, []);
    expect(result.ok).toBe(true);
  });

  it('blocks navigation to disallowed routes', () => {
    const config = RunConfigSchema.parse({
      ...baseConfig,
      allowedRoutes: ['https://app.local/dashboard'],
    });
    const result = service.validate({ type: 'navigate', to: 'https://evil.com', reason: 'test' }, config, []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('NAVIGATION_BLOCKED');
  });

  it('allows navigation to allowed routes', () => {
    const config = RunConfigSchema.parse({
      ...baseConfig,
      allowedRoutes: ['https://app.local'],
    });
    const result = service.validate({ type: 'navigate', to: 'https://app.local/dashboard', reason: 'test' }, config, []);
    expect(result.ok).toBe(true);
  });

  it('blocks clickAtCoordinates without 3 prior semantic failures', () => {
    const result = service.validate({ type: 'clickAtCoordinates', x: 10, y: 20, reason: 'test', risk: 'HIGH' }, baseConfig, []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/3 previous semantic failures/);
  });

  it('allows clickAtCoordinates after 3 failed attempts', () => {
    const attempts = [
      { actionType: 'click' as const, result: 'FAILED' as const, ts: '1' },
      { actionType: 'fill' as const, result: 'FAILED' as const, ts: '2' },
      { actionType: 'press' as const, result: 'FAILED' as const, ts: '3' },
    ];
    const result = service.validate({ type: 'clickAtCoordinates', x: 10, y: 20, reason: 'test', risk: 'HIGH' }, baseConfig, attempts);
    expect(result.ok).toBe(true);
  });

  describe('validateDestructiveText', () => {
    it('allows non-destructive text', () => {
      const result = service.validateDestructiveText('clicar no botao salvar', baseConfig);
      expect(result.ok).toBe(true);
    });

    it('blocks destructive text when policy is BLOCK', () => {
      const result = service.validateDestructiveText('excluir produto da lista', baseConfig);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toMatch(/BLOCK/);
    });

    it('allows destructive text when policy is ALLOW', () => {
      const config = RunConfigSchema.parse({
        ...baseConfig,
        runtime: { destructiveActionPolicy: 'ALLOW' },
      });
      const result = service.validateDestructiveText('excluir produto da lista', config);
      expect(result.ok).toBe(true);
    });

    it('blocks destructive text when policy is ASK_APPROVAL', () => {
      const config = RunConfigSchema.parse({
        ...baseConfig,
        runtime: { destructiveActionPolicy: 'ASK_APPROVAL' },
      });
      const result = service.validateDestructiveText('confirmar pagamento do pedido', config);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toMatch(/ASK_APPROVAL/);
    });
  });
});
