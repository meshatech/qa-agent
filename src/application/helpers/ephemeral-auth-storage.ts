import { join } from 'node:path';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

export const EPHEMERAL_AUTH_DIR = '.auth';
export const EPHEMERAL_STORAGE_STATE_FILE = 'storage-state.json';

export function ephemeralAuthStoragePath(runDir: string): string {
  return join(runDir, EPHEMERAL_AUTH_DIR, EPHEMERAL_STORAGE_STATE_FILE);
}

/** Routes ssoRedirect session persistence into the current run directory (never repo root). */
export function applyEphemeralAuthStorage(config: RunConfig, runDir: string): RunConfig {
  if (config.auth.kind !== 'ssoRedirect') return config;
  return {
    ...config,
    auth: {
      ...config.auth,
      storageStatePath: ephemeralAuthStoragePath(runDir),
    },
  };
}
