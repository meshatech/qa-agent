import { describe, expect, it } from 'vitest';
import { applyEphemeralAuthStorage, ephemeralAuthStoragePath } from '../src/application/helpers/ephemeral-auth-storage.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';
import { DEFAULT_TEST_MEMORY_CONFIG } from './helpers/memory-config.fixture.js';

const BASE: RunConfig = {
  baseUrl: 'https://meshamail.mesha.com.br/',
  appDomains: ['meshamail.mesha.com.br'],
  demand: { id: 'd1', title: 't', description: 'd' },
  browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
  auth: {
    kind: 'ssoRedirect',
    loginButtonSelector: { strategy: 'role', role: 'button', name: 'Login Mesha' },
    usernameEnv: 'MESHA_EMAIL',
    passwordEnv: 'MESHA_PASSWORD',
  },
  llm: { provider: 'fake', model: 'fake', apiKeyEnv: 'X', maxSchemaRetries: 1, promptVersion: 'v1', temperature: 0, maxTokens: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000 },
  timeouts: { quiescenceMs: 1000, actionMs: 1000, navigationMs: 1000, scenarioMs: 1000, runMs: 1000 },
  runtime: { maxActionsPerTask: 1, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: false, maxOpenAttempts: 0, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false }, enforceSingleTab: false, engine: 'legacy' },
  recovery: { maxAttemptsPerTask: 1, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
  classifier: { treatThirdPartyNetwork5xxAsBug: false },
  privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
  output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
  scenarioSelection: { maxScenarios: 1 },
  evidence: { video: 'off', trace: 'off' },
  memory: DEFAULT_TEST_MEMORY_CONFIG,
  agentVersion: '0.1.0',
};

describe('ephemeral auth storage', () => {
  it('places ssoRedirect storage under run dir', () => {
    const runDir = '/tmp/qa-agent-runs/2026-01-01__abc';
    expect(ephemeralAuthStoragePath(runDir)).toBe('/tmp/qa-agent-runs/2026-01-01__abc/.auth/storage-state.json');
    const patched = applyEphemeralAuthStorage(BASE, runDir);
    expect(patched.auth.kind).toBe('ssoRedirect');
    if (patched.auth.kind === 'ssoRedirect') {
      expect(patched.auth.storageStatePath).toBe(ephemeralAuthStoragePath(runDir));
    }
  });

  it('leaves non-sso auth unchanged', () => {
    const config: RunConfig = { ...BASE, auth: { kind: 'none' } };
    expect(applyEphemeralAuthStorage(config, '/run')).toEqual(config);
  });
});
