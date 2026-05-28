import { describe, expect, it, vi } from 'vitest';

import { ScenarioGeneratorService } from '../src/application/services/scenario-generator.service.js';
import { ScenarioPlannerService } from '../src/application/services/scenario-planner.service.js';
import type { QaScenario } from '../src/domain/models/run.model.js';
import type { MemoryChunk } from '../src/domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../src/domain/schemas/correlation.schema.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

function makeConfig(): RunConfig {
  return {
    baseUrl: 'https://example.com',
    appDomains: ['example.com'],
    demand: { id: 'DEM-001', title: 'Test', description: 'Test demand', acceptanceCriteria: ['Criterion A'] },
    auth: { kind: 'none' },
    llm: { provider: 'fake', model: 'test', apiKeyEnv: 'TEST_KEY', maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1', temperature: 0, maxTokens: 100 },
    browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false }, tools: { enabled: false } },
    recovery: { maxAttemptsPerTask: 2, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], treatThirdPartyNetwork5xxAsBug: false },
    privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
    output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
    agentVersion: '0.1.0',
  };
}

function makeRequired(id: string, title: string, rationale: string): RequiredScenario {
  return { id, title, intent: 'POSITIVE', rationale, relatedFiles: [], riskScore: 0.5 };
}

describe('ScenarioGeneratorService', () => {
  const planner = { plan: vi.fn() } as unknown as ScenarioPlannerService;
  const generator = new ScenarioGeneratorService(planner);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('generates scenarios for uncovered RequiredScenario', async () => {
    const config = makeConfig();
    const uncovered = [makeRequired('REQ-001', 'Logout do usuario', 'Usuario realiza logout e volta para login')];
    const planned: QaScenario[] = [{ id: 'scenario-001', title: 'Logout', status: 'PLANNED', tasks: [{ id: 'T001', title: 'Logout', expected: 'Logout ok', status: 'PENDING' }] }];
    vi.mocked(planner.plan).mockResolvedValue(planned);

    const result = await generator.generate({ uncoveredRequiredScenarios: uncovered, config });

    expect(result.generated).toEqual(planned);
    expect(planner.plan).toHaveBeenCalledTimes(1);
  });

  it('includes affected routes/components in config passed to planner', async () => {
    const config = makeConfig();
    const uncovered = [makeRequired('REQ-001', 'Logout', 'Logout do sistema')];
    vi.mocked(planner.plan).mockResolvedValue([]);

    await generator.generate({
      uncoveredRequiredScenarios: uncovered,
      config,
      context: {
        affectedRoutes: ['/login', '/dashboard'],
        affectedComponents: ['LoginForm', 'AccountMenu'],
      },
    });

    const passedConfig = vi.mocked(planner.plan).mock.calls[0][0];
    expect(passedConfig.demand.description).toContain('/login');
    expect(passedConfig.demand.description).toContain('/dashboard');
    expect(passedConfig.demand.description).toContain('LoginForm');
    expect(passedConfig.demand.description).toContain('AccountMenu');
  });

  it('includes memoryRefs in config', async () => {
    const config = makeConfig();
    const uncovered = [makeRequired('REQ-001', 'Logout', 'Logout do sistema')];
    const memoryRefs: MemoryChunk[] = [
      { id: 'MEM-001', type: 'scenario', title: 'Logout flow', content: 'User clicks logout', sourceFile: '.agent-qa/memory.md' },
    ];
    vi.mocked(planner.plan).mockResolvedValue([]);

    await generator.generate({
      uncoveredRequiredScenarios: uncovered,
      config,
      context: { memoryRefs },
    });

    const passedConfig = vi.mocked(planner.plan).mock.calls[0][0];
    expect(passedConfig.demand.description).toContain('Logout flow');
    expect(passedConfig.demand.description).toContain('MEM-001');
  });

  it('returns empty and does not call planner when no gaps', async () => {
    const config = makeConfig();

    const result = await generator.generate({ uncoveredRequiredScenarios: [], config });

    expect(result.generated).toEqual([]);
    expect(result.warnings.some((w) => w.includes('No uncovered required scenarios'))).toBe(true);
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it('propagates planner result without modification', async () => {
    const config = makeConfig();
    const uncovered = [makeRequired('REQ-001', 'Login', 'Login do sistema')];
    const planned: QaScenario[] = [
      { id: 'scenario-001', title: 'Login', status: 'PLANNED', tasks: [] },
      { id: 'scenario-002', title: 'Invalid login', status: 'PLANNED', tasks: [] },
    ];
    vi.mocked(planner.plan).mockResolvedValue(planned);

    const result = await generator.generate({ uncoveredRequiredScenarios: uncovered, config });

    expect(result.generated).toEqual(planned);
    expect(result.generated[0].id).toBe('scenario-001');
    expect(result.generated[1].id).toBe('scenario-002');
  });

  it('does not mutate original config', async () => {
    const config = makeConfig();
    const originalDescription = config.demand.description;
    const uncovered = [makeRequired('REQ-001', 'Login', 'Login do sistema')];
    vi.mocked(planner.plan).mockResolvedValue([]);

    await generator.generate({ uncoveredRequiredScenarios: uncovered, config });

    expect(config.demand.description).toBe(originalDescription);
    expect(config.demand.title).toBe('Test');
  });
});
