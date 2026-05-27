import { describe, expect, it } from 'vitest';

import { DemandDiffMemoryCorrelatorService } from '../src/application/services/demand-diff-memory-correlator.service.js';
import { prepareRequiredScenariosArtifact } from '../src/domain/helpers/required-scenarios-artifact.js';
import {
  CorrelationResultSchema,
  createBlockedCorrelationResult,
} from '../src/domain/schemas/correlation.schema.js';
import { RequiredScenarioSchema } from '../src/domain/schemas/required-scenario.schema.js';
import type { DemandContext } from '../src/domain/schemas/demand-context.schema.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';

const BASE_DEMAND: DemandContext = {
  taskId: 'PRJ-11404',
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
    title: 'PRJ-11404 login',
    author: 'dev',
    clickUpTaskId: 'PRJ-11404',
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

describe('prepareRequiredScenariosArtifact', () => {
  it('serializes OK correlator result with complete RequiredScenario[]', () => {
    const result = new DemandDiffMemoryCorrelatorService().correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    const parsed = CorrelationResultSchema.parse(JSON.parse(prepareRequiredScenariosArtifact(result)));

    expect(parsed.status).toBe('OK');
    expect(parsed.scenarios.length).toBeGreaterThan(0);
    for (const scenario of parsed.scenarios) {
      expect(RequiredScenarioSchema.parse(scenario)).toEqual(scenario);
    }
  });

  it('serializes BLOCKED result with empty scenarios and blockReason', () => {
    const blocked = createBlockedCorrelationResult('acceptanceCriteria is empty');

    const parsed = CorrelationResultSchema.parse(JSON.parse(prepareRequiredScenariosArtifact(blocked)));

    expect(parsed.status).toBe('BLOCKED');
    expect(parsed.scenarios).toEqual([]);
    expect(parsed.blockReason).toBe('acceptanceCriteria is empty');
  });

  it('rejects invalid correlation result', () => {
    expect(() =>
      prepareRequiredScenariosArtifact({
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
