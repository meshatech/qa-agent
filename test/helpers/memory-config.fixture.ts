import type { RunConfig } from '../../src/domain/schemas/config.schema.js';

export const DEFAULT_TEST_MEMORY_CONFIG: RunConfig['memory'] = {
  source: 'file',
  writeBack: 'db',
  schemaVersion: 'v1',
};
