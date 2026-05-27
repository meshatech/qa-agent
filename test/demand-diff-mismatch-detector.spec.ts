import { describe, expect, it } from 'vitest';

import { consumeDemandContext } from '../src/domain/helpers/demand-context-consumer.js';
import { detectDemandDiffMismatch } from '../src/domain/helpers/demand-diff-mismatch-detector.js';
import { consumePrDiffContext } from '../src/domain/helpers/pr-diff-context-consumer.js';
import type { DemandContext } from '../src/domain/schemas/demand-context.schema.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';

const LOGIN_PR_DIFF: PrDiffContext = {
  schemaVersion: 'pr-diff-context.v1',
  pullRequest: {
    prNumber: 1,
    baseBranch: 'main',
    headBranch: 'feature/login',
    title: 'PRJ-11401 login',
    author: 'dev',
    clickUpTaskId: 'PRJ-11401',
  },
  changedFiles: [
    {
      path: 'src/routes/login.ts',
      status: 'modified',
      kind: 'route',
      positiveLines: [],
      negativeLines: [],
      contextLines: [],
    },
  ],
  affectedRoutes: ['/login'],
  affectedSchemas: [],
};

const LOGIN_DEMAND: DemandContext = {
  taskId: 'PRJ-11401',
  title: 'Login routes',
  description: 'Update src routes login module',
  acceptanceCriteria: ['Login routes validates user credentials on /login path'],
  attachments: [],
  status: 'fazendo',
  assignees: [],
  priority: null,
  dueDate: null,
};

describe('detectDemandDiffMismatch', () => {
  it('returns no risks when demand aligns with login diff', () => {
    const demand = consumeDemandContext(LOGIN_DEMAND);
    const prDiff = consumePrDiffContext(LOGIN_PR_DIFF);

    expect(detectDemandDiffMismatch({ demand, prDiff })).toEqual([]);
  });

  it('detects mismatch when demand is about billing but diff touches login', () => {
    const demand = consumeDemandContext({
      ...LOGIN_DEMAND,
      title: 'Billing export improvements',
      description: 'Invoice billing dashboard export',
      acceptanceCriteria: ['Billing invoice export supports CSV format'],
    });
    const prDiff = consumePrDiffContext(LOGIN_PR_DIFF);

    const risks = detectDemandDiffMismatch({ demand, prDiff });

    expect(risks).toHaveLength(1);
    expect(risks[0]?.type).toBe('demand_diff_mismatch');
    expect(risks[0]?.severity).toBe('MEDIUM');
    expect(risks[0]?.description).toContain('low lexical overlap');
  });

  it('returns no risks when description aligns with changed file path', () => {
    const demand = consumeDemandContext({
      ...LOGIN_DEMAND,
      title: 'Feature work',
      description: 'Update billing invoice export module',
      acceptanceCriteria: ['Billing invoice export supports CSV format'],
    });
    const prDiff = consumePrDiffContext({
      ...LOGIN_PR_DIFF,
      changedFiles: [
        {
          path: 'src/routes/billing-invoice-export.ts',
          status: 'modified',
          kind: 'route',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ],
      affectedRoutes: ['/billing/invoice/export'],
    });

    expect(detectDemandDiffMismatch({ demand, prDiff })).toEqual([]);
  });

  it('returns no mismatch when one acceptance criterion aligns even if title is generic', () => {
    const demand = consumeDemandContext({
      ...LOGIN_DEMAND,
      title: 'General platform improvements for users and system',
      description: 'Broad maintenance work across modules',
      acceptanceCriteria: ['Login routes validates user credentials on /login path'],
    });
    const prDiff = consumePrDiffContext(LOGIN_PR_DIFF);

    expect(detectDemandDiffMismatch({ demand, prDiff })).toEqual([]);
  });

  it('emits mismatch when only one of many criteria aligns with the diff', () => {
    const billingCriteria = Array.from({ length: 10 }, (_, index) =>
      `Billing invoice export feature ${index + 1} supports CSV format`,
    );
    const demand = consumeDemandContext({
      ...LOGIN_DEMAND,
      title: 'Billing and login platform work',
      description: 'Mixed billing exports and login validation',
      acceptanceCriteria: [
        ...billingCriteria,
        'Login routes validates user credentials on /login path',
      ],
    });
    const prDiff = consumePrDiffContext(LOGIN_PR_DIFF);

    const risks = detectDemandDiffMismatch({ demand, prDiff });

    expect(risks).toHaveLength(1);
    expect(risks[0]?.type).toBe('demand_diff_mismatch');
    expect(risks[0]?.description).toContain('1/11 criteria covered');
  });

  it('emits mismatch when fewer than half of criteria align with the diff', () => {
    const demand = consumeDemandContext({
      ...LOGIN_DEMAND,
      title: 'Login and billing updates',
      description: 'Session and billing maintenance',
      acceptanceCriteria: [
        'Login routes validates user credentials on /login path',
        'Authentication session timeout policy on dashboard',
        'Billing invoice export supports CSV format',
        'Billing dashboard reconciles monthly statements',
      ],
    });
    const prDiff = consumePrDiffContext(LOGIN_PR_DIFF);

    const risks = detectDemandDiffMismatch({ demand, prDiff });

    expect(risks).toHaveLength(1);
    expect(risks[0]?.type).toBe('demand_diff_mismatch');
    expect(risks[0]?.description).toContain('1/4 criteria covered');
  });

  it('returns no mismatch when at least half of criteria align with the diff', () => {
    const demand = consumeDemandContext({
      ...LOGIN_DEMAND,
      title: 'Login hardening',
      description: 'Improve login route validation',
      acceptanceCriteria: [
        'Login routes validates user credentials on /login path',
        'Login route rejects invalid passwords on /login path',
      ],
    });
    const prDiff = consumePrDiffContext(LOGIN_PR_DIFF);

    expect(detectDemandDiffMismatch({ demand, prDiff })).toEqual([]);
  });

  it('returns no risks when demand has no tokenizable text', () => {
    const demand = consumeDemandContext({
      ...LOGIN_DEMAND,
      title: 'QA',
      description: '',
      acceptanceCriteria: ['Do it'],
    });
    const prDiff = consumePrDiffContext(LOGIN_PR_DIFF);

    expect(detectDemandDiffMismatch({ demand, prDiff })).toEqual([]);
  });
});
