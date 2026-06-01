import type { QaScenario } from '../models/run.model.js';

export function prepareSelectedScenariosArtifact(selectedScenarios: QaScenario[]): string {
  return JSON.stringify({
    schemaVersion: 'selected-scenarios.v1',
    generatedAt: new Date().toISOString(),
    count: selectedScenarios.length,
    scenarios: selectedScenarios,
  }, null, 2);
}
