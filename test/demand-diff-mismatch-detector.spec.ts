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
