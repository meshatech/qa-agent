import { describe, expect, it } from 'vitest';
import { formatPipelineAllSummary } from '../src/application/helpers/format-pipeline-all-summary.js';

describe('formatPipelineAllSummary', () => {
  it('formats all steps with no blocking', () => {
    const result = formatPipelineAllSummary({
      steps: [
        { name: 'prepare', status: 'OK' },
        { name: 'correlate', status: 'OK' },
        { name: 'risk', status: 'OK' },
      ],
    });
    expect(result).toBe('[pipeline all] prepare=OK correlate=OK risk=OK');
  });

  it('appends stopped at when blockedAt is present', () => {
    const result = formatPipelineAllSummary({
      steps: [{ name: 'prepare', status: 'BLOCKED' }],
      blockedAt: 'prepare',
    });
    expect(result).toBe('[pipeline all] prepare=BLOCKED (stopped at prepare)');
  });

  it('handles empty steps', () => {
    const result = formatPipelineAllSummary({ steps: [] });
    expect(result).toBe('[pipeline all] ');
  });
});
