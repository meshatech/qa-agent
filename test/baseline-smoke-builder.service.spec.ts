import { describe, expect, it } from 'vitest';

import { BaselineSmokeBuilderService } from '../src/application/services/baseline-smoke-builder.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

function makeBuilder() {
  return new BaselineSmokeBuilderService();
}

describe('BaselineSmokeBuilderService', () => {
  it('generates an ExecutionPlan', () => {
    const builder = makeBuilder();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const plan = builder.build(config);

    expect(plan.schemaVersion).toBe('execution-plan.v1');
    expect(plan.planId).toBe('onboarding-smoke');
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('covers navigation to baseUrl', () => {
    const builder = makeBuilder();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const plan = builder.build(config);
    const navStep = plan.steps.find((s) => s.id === 'ONB-001');

    expect(navStep).toBeDefined();
    expect(navStep?.description).toBe('Navigate to base URL');
    expect(navStep?.action.type).toBe('navigate');
    expect((navStep!.action as { to: string }).to).toBe('https://app.local');
  });

  it('covers form login when auth is formLogin and credentials exist', () => {
    process.env.TEST_USER = 'alice';
    process.env.TEST_PASS = 'secret';

    const builder = makeBuilder();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      auth: {
        kind: 'formLogin',
        loginUrl: 'https://app.local/login',
        usernameSelector: '#username',
        passwordSelector: '#password',
        submitSelector: 'button',
        usernameEnv: 'TEST_USER',
        passwordEnv: 'TEST_PASS',
      },
    });

    const plan = builder.build(config);
    expect(plan.steps.map((s) => s.id)).toContain('ONB-002');
    expect(plan.steps.map((s) => s.id)).toContain('ONB-003');
    expect(plan.steps.map((s) => s.id)).toContain('ONB-004');

    delete process.env.TEST_USER;
    delete process.env.TEST_PASS;
  });

  it('adds warning step when formLogin credentials are missing', () => {
    const builder = makeBuilder();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      auth: {
        kind: 'formLogin',
        loginUrl: 'https://app.local/login',
        usernameSelector: '#username',
        passwordSelector: '#password',
        submitSelector: 'button',
        usernameEnv: 'MISSING_USER',
        passwordEnv: 'MISSING_PASS',
      },
    });

    const plan = builder.build(config);
    expect(plan.steps.map((s) => s.id)).toContain('ONB-002-WARN');
  });

  it('covers allowedRoutes when declared', () => {
    const builder = makeBuilder();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
      allowedRoutes: ['/dashboard', '/profile'],
    });

    const plan = builder.build(config);
    expect(plan.steps.some((s) => s.description.includes('/dashboard'))).toBe(true);
    expect(plan.steps.some((s) => s.description.includes('/profile'))).toBe(true);
  });

  it('does not include destructive actions', () => {
    const builder = makeBuilder();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const plan = builder.build(config);
    expect(plan.runtime.destructiveActionPolicy).toBe('BLOCK');

    for (const step of plan.steps) {
      if (step.action.type === 'clickAtCoordinates') {
        expect((step.action as { risk?: string }).risk).not.toBe('HIGH');
      }
    }
  });

  it('includes final verification step', () => {
    const builder = makeBuilder();
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D', title: 'T', description: 'D' },
    });

    const plan = builder.build(config);
    const lastStep = plan.steps[plan.steps.length - 1];
    expect(lastStep?.description).toContain('Verify page loaded');
  });
});
