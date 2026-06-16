import { afterEach, describe, expect, it } from 'vitest';
import { applyBaseUrlOverride } from '../src/application/helpers/apply-base-url-override.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';
import { DEFAULT_TEST_MEMORY_CONFIG } from './helpers/memory-config.fixture.js';

const BASE_CONFIG: RunConfig = {
  baseUrl: 'https://app.example.com',
  appDomains: ['example.com'],
  demand: { id: 't1', title: 'Test', description: 'Test demand' },
  browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
  auth: { kind: 'none' },
  llm: {
    provider: 'fake',
    model: 'fake',
    apiKeyEnv: 'GROQ_PROVIDER',
    maxSchemaRetries: 2,
    promptVersion: 'v1',
    temperature: 0,
    maxTokens: 2048,
    rateLimitRetries: 3,
    rateLimitMaxWaitMs: 30000,
  },
  timeouts: { quiescenceMs: 3000, actionMs: 15000, navigationMs: 30000, scenarioMs: 180000, runMs: 1800000 },
  runtime: {
    maxActionsPerTask: 3,
    mode: 'HYBRID_GUARDED',
    maxAttemptsPerStep: 2,
    maxReplansPerScenario: 2,
    destructiveActionPolicy: 'BLOCK',
    semanticKeys: {},
    semanticAliases: {},
    elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] },
    tools: { enabled: false },
    enforceSingleTab: false,
    engine: 'legacy',
  },
  recovery: { maxAttemptsPerTask: 3, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 5 },
  classifier: { treatThirdPartyNetwork5xxAsBug: false },
  privacy: { maskEmails: false, maskJwt: true, maskCookies: true },
  output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
  scenarioSelection: { maxScenarios: 5 },
  evidence: { video: 'off', trace: 'off' },
  memory: DEFAULT_TEST_MEMORY_CONFIG,
  agentVersion: '0.1.0',
};

afterEach(() => {
  delete process.env.QA_AGENT_BASE_URL;
  delete process.env.QA_AGENT_PREVIEW_DOMAIN;
});

describe('applyBaseUrlOverride', () => {
  it('returns config unchanged when no env overrides are set', () => {
    const result = applyBaseUrlOverride(BASE_CONFIG, {});
    expect(result).toEqual(BASE_CONFIG);
  });

  it('overrides baseUrl and adds hostname to appDomains when QA_AGENT_BASE_URL is set', () => {
    const result = applyBaseUrlOverride(BASE_CONFIG, {
      QA_AGENT_BASE_URL: 'https://pr-42.preview.meshamail.dev',
    });
    expect(result.baseUrl).toBe('https://pr-42.preview.meshamail.dev');
    expect(result.appDomains).toContain('example.com');
    expect(result.appDomains).toContain('pr-42.preview.meshamail.dev');
  });

  it('adds preview domain from QA_AGENT_PREVIEW_DOMAIN stripping wildcard prefix', () => {
    const result = applyBaseUrlOverride(BASE_CONFIG, {
      QA_AGENT_PREVIEW_DOMAIN: '*.preview.meshamail.dev',
    });
    expect(result.baseUrl).toBe('https://app.example.com');
    expect(result.appDomains).toContain('preview.meshamail.dev');
    expect(result.appDomains).not.toContain('*.preview.meshamail.dev');
  });

  it('prefers QA_AGENT_BASE_URL over config baseUrl when both preview domain and override URL are set', () => {
    const result = applyBaseUrlOverride(BASE_CONFIG, {
      QA_AGENT_BASE_URL: 'https://pr-99.preview.meshamail.dev',
      QA_AGENT_PREVIEW_DOMAIN: '*.preview.meshamail.dev',
    });
    expect(result.baseUrl).toBe('https://pr-99.preview.meshamail.dev');
    expect(result.appDomains).toContain('preview.meshamail.dev');
    expect(result.appDomains).not.toContain('pr-99.preview.meshamail.dev');
  });

  it('does not duplicate appDomains when hostname already present', () => {
    const config: RunConfig = { ...BASE_CONFIG, appDomains: ['example.com', 'pr-42.preview.meshamail.dev'] };
    const result = applyBaseUrlOverride(config, {
      QA_AGENT_BASE_URL: 'https://pr-42.preview.meshamail.dev',
    });
    expect(result.appDomains.filter((d) => d === 'pr-42.preview.meshamail.dev')).toHaveLength(1);
  });
});
