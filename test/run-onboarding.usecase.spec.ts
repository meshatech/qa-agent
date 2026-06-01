import { describe, it, expect, vi } from 'vitest';
import { RunOnboardingUseCase } from '../src/application/use-cases/run-onboarding.usecase.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import { ConfigError } from '../src/domain/errors.js';

describe('RunOnboardingUseCase', () => {
  const validConfig = RunConfigSchema.parse({
    baseUrl: 'https://app.local',
    appDomains: ['app.local'],
    demand: { id: 'D', title: 'T', description: 'D' },
  });

  function makeUseCase(overrides: {
    load?: unknown;
    createRunDir?: string;
    onboardingResult?: import('../src/domain/models/readiness.model.js').OnboardingResult;
  } = {}) {
    const configLoader: import('../src/application/ports/config-loader.port.js').ConfigLoaderPort = {
      load: vi.fn().mockResolvedValue(overrides.load ?? validConfig),
    };
    const repo: import('../src/application/ports/run-repository.port.js').RunRepositoryPort = {
      createRunDir: vi.fn().mockResolvedValue(overrides.createRunDir ?? '/tmp/runs/2025-01-01'),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn(),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const onboardingExecute = vi.fn().mockResolvedValue(
      overrides.onboardingResult ?? {
        readiness: 'READY',
        baselineReportPath: '/tmp/report.md',
        warnings: [],
      },
    );
    const onboarding = { execute: onboardingExecute } as unknown as import('../src/application/services/project-onboarding.service.js').ProjectOnboardingService;

    return {
      useCase: new RunOnboardingUseCase(configLoader, repo, onboarding),
      configLoader,
      repo,
      onboardingExecute,
    };
  }

  it('loads config and delegates to ProjectOnboardingService', async () => {
    const { useCase, onboardingExecute } = makeUseCase();
    const result = await useCase.execute('/path/config.json');

    expect(result.readiness).toBe('READY');
    expect(onboardingExecute).toHaveBeenCalledOnce();
  });

  it('uses dirname(configPath) as projectPath fallback', async () => {
    const { useCase, onboardingExecute } = makeUseCase();
    await useCase.execute('/some/path/config.json');

    const [, , projectPath] = onboardingExecute.mock.calls[0];
    expect(projectPath).toBe('/some/path');
  });

  it('uses --project-dir override when provided', async () => {
    const { useCase, onboardingExecute } = makeUseCase();
    await useCase.execute('/some/path/config.json', '/custom/project');

    const [, , projectPath] = onboardingExecute.mock.calls[0];
    expect(projectPath).toBe('/custom/project');
  });

  it('uses --output-dir override when provided', async () => {
    const { useCase, onboardingExecute } = makeUseCase();
    await useCase.execute('/some/path/config.json', undefined, '/custom/output');

    const [, outputDir] = onboardingExecute.mock.calls[0];
    expect(outputDir).toBe('/custom/output');
  });

  it('creates runDir via repo when outputDir is not provided', async () => {
    const { useCase, repo, onboardingExecute } = makeUseCase({ createRunDir: '/tmp/auto-dir' });
    await useCase.execute('/some/path/config.json');

    expect(repo.createRunDir).toHaveBeenCalledOnce();
    const [, outputDir] = onboardingExecute.mock.calls[0];
    expect(outputDir).toBe('/tmp/auto-dir');
  });

  it('throws ConfigError when config is invalid', async () => {
    const { useCase } = makeUseCase({ load: { invalid: true } });
    await expect(useCase.execute('/path/config.json')).rejects.toBeInstanceOf(ConfigError);
  });

  it('propagates ONBOARDING_BLOCKED result', async () => {
    const { useCase } = makeUseCase({
      onboardingResult: {
        readiness: 'ONBOARDING_BLOCKED',
        baselineReportPath: null,
        warnings: ['Browser open failed'],
      },
    });

    const result = await useCase.execute('/path/config.json');
    expect(result.readiness).toBe('ONBOARDING_BLOCKED');
  });
});
