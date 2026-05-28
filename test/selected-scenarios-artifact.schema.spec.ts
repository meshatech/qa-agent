import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { SelectedScenariosArtifactSchema } from '../src/domain/schemas/selected-scenarios-artifact.schema.js';

function makeScenario(id: string): unknown {
  return {
    id,
    title: `Scenario ${id}`,
    tasks: [{ id: 'T001', title: 'Task', expected: 'Ok', status: 'PENDING' }],
    status: 'PLANNED',
  };
}

function makeValidArtifact(): Record<string, unknown> {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'scenario-orchestrator',
    scenarios: [makeScenario('SCN-001')],
    selected: [makeScenario('SCN-001')],
    generated: [],
    uncoveredRequiredScenarios: [],
    warnings: [],
    summary: { total: 1, selected: 1, generated: 0, uncovered: 0, truncated: false, maxScenarios: 5 },
  };
}

describe('SelectedScenariosArtifactSchema', () => {
  it('parses a valid artifact', () => {
    const result = SelectedScenariosArtifactSchema.parse(makeValidArtifact());
    expect(result.version).toBe(1);
    expect(result.source).toBe('scenario-orchestrator');
    expect(result.scenarios).toHaveLength(1);
  });

  it('rejects version different from 1', () => {
    const artifact = makeValidArtifact();
    artifact.version = 2;
    expect(() => SelectedScenariosArtifactSchema.parse(artifact)).toThrow(ZodError);
  });

  it('rejects invalid generatedAt', () => {
    const artifact = makeValidArtifact();
    artifact.generatedAt = 'not-a-date';
    expect(() => SelectedScenariosArtifactSchema.parse(artifact)).toThrow(ZodError);
  });

  it('rejects missing scenarios', () => {
    const artifact = makeValidArtifact() as Record<string, unknown>;
    delete artifact.scenarios;
    expect(() => SelectedScenariosArtifactSchema.parse(artifact)).toThrow(ZodError);
  });

  it('rejects maxScenarios = 0 in summary', () => {
    const artifact = makeValidArtifact() as Record<string, unknown>;
    (artifact.summary as Record<string, unknown>).maxScenarios = 0;
    expect(() => SelectedScenariosArtifactSchema.parse(artifact)).toThrow(ZodError);
  });

  it('rejects negative total in summary', () => {
    const artifact = makeValidArtifact() as Record<string, unknown>;
    (artifact.summary as Record<string, unknown>).total = -1;
    expect(() => SelectedScenariosArtifactSchema.parse(artifact)).toThrow(ZodError);
  });

  it('rejects invalid source', () => {
    const artifact = makeValidArtifact();
    artifact.source = 'other';
    expect(() => SelectedScenariosArtifactSchema.parse(artifact)).toThrow(ZodError);
  });
});
