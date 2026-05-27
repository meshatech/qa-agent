import { describe, expect, it } from 'vitest';

import { DemandDiffMemoryCorrelatorService } from '../src/application/services/demand-diff-memory-correlator.service.js';
import { prepareCorrelationReportArtifact } from '../src/domain/helpers/correlation-report-artifact.js';
import { createBlockedCorrelationResult } from '../src/domain/schemas/correlation.schema.js';
import type { DemandContext } from '../src/domain/schemas/demand-context.schema.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';

const BASE_DEMAND: DemandContext = {
  taskId: 'PRJ-11405',
  title: 'Login improvements',
  description: 'Improve login',
  acceptanceCriteria: ['Login route validates user credentials'],
  attachments: [],
  status: 'fazendo',
  assignees: [],
  priority: null,
  dueDate: null,
};

const BASE_PR_DIFF: PrDiffContext = {
  schemaVersion: 'pr-diff-context.v1',
  pullRequest: {
    prNumber: 1,
    baseBranch: 'main',
    headBranch: 'feature/login',
    title: 'PRJ-11405 login',
    author: 'dev',
    clickUpTaskId: 'PRJ-11405',
  },
  changedFiles: [
    {
      path: 'src/routes/login.ts',
      status: 'modified',
      kind: 'route',
      positiveLines: [{ type: 'added', lineNumber: 1, content: 'validate credentials' }],
      negativeLines: [],
      contextLines: [],
    },
  ],
  affectedRoutes: ['/login'],
  affectedSchemas: [],
};

describe('prepareCorrelationReportArtifact', () => {
  it('renders OK result with scenarios, correlations and risks sections', () => {
    const result = new DemandDiffMemoryCorrelatorService().correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    const markdown = prepareCorrelationReportArtifact(result, {
      demandTitle: BASE_DEMAND.title,
      prNumber: BASE_PR_DIFF.pullRequest.prNumber,
    });

    expect(markdown).toContain('## Required Scenarios');
    expect(markdown).toContain('## Correlations');
    expect(markdown).toContain('## Risks');
    expect(markdown).toContain('Demand: Login improvements');
    expect(markdown).toContain('PR: #1');
  });

  it('renders BLOCKED result with block reason', () => {
    const blocked = createBlockedCorrelationResult('acceptanceCriteria is empty');

    const markdown = prepareCorrelationReportArtifact(blocked, { prNumber: 99 });

    expect(markdown).toContain('BLOCKED');
    expect(markdown).toContain('## Block Reason');
    expect(markdown).toContain('acceptanceCriteria is empty');
  });

  it('rejects invalid correlation result', () => {
    expect(() =>
      prepareCorrelationReportArtifact({
        schemaVersion: 'correlation-result.v1',
        status: 'OK',
        scenarios: [],
        correlations: [],
        risks: [],
        warnings: [],
        extra: 'field',
      } as never),
    ).toThrow();
  });
});
