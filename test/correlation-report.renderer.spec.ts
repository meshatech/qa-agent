import { describe, expect, it } from 'vitest';

import { DemandDiffMemoryCorrelatorService } from '../src/application/services/demand-diff-memory-correlator.service.js';
import { createBlockedCorrelationResult } from '../src/domain/schemas/correlation.schema.js';
import { renderCorrelationReport } from '../src/infra/persistence/correlation-report.renderer.js';

describe('renderCorrelationReport', () => {
  it('includes scenarios and block reason', () => {
    const blocked = createBlockedCorrelationResult('acceptanceCriteria is empty');
    const markdown = renderCorrelationReport(blocked, { demandTitle: 'Test', prNumber: 99 });

    expect(markdown).toContain('# Correlation Report');
    expect(markdown).toContain('BLOCKED');
    expect(markdown).toContain('acceptanceCriteria');
    expect(markdown).toContain('Demand: Test');
    expect(markdown).toContain('PR: #99');
  });

  it('renders OK result sections from correlator output', () => {
    const service = new DemandDiffMemoryCorrelatorService();
    const result = service.correlate({
      demand: {
        taskId: 'PRJ-1',
        title: 'Login',
        description: '',
        acceptanceCriteria: ['Login route validates user credentials'],
        attachments: [],
        status: 'fazendo',
        assignees: [],
        priority: null,
        dueDate: null,
      },
      prDiff: {
        schemaVersion: 'pr-diff-context.v1',
        pullRequest: {
          prNumber: 1,
          baseBranch: 'main',
          headBranch: 'feature',
          title: 'PR',
          author: 'dev',
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
      },
      memoryResults: [],
    });

    const markdown = renderCorrelationReport(result);
    expect(markdown).toContain('## Required Scenarios');
    expect(markdown).toContain('## Correlations');
  });
});
