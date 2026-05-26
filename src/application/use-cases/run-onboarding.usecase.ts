import { Inject, Injectable } from '@nestjs/common';
import { dirname } from 'node:path';

import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { OnboardingResult } from '../../domain/models/readiness.model.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import { ProjectOnboardingService } from '../services/project-onboarding.service.js';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';
import { ConfigError } from '../../domain/errors.js';
import { ZodError } from 'zod';

@Injectable()
export class RunOnboardingUseCase {
  constructor(
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
    @Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort,
    @Inject(ProjectOnboardingService) private readonly onboarding: ProjectOnboardingService,
  ) {}

  async execute(
    configPath: string,
    projectDir?: string,
    outputDir?: string,
    _options?: { headed?: boolean },
  ): Promise<OnboardingResult> {
    const raw = await this.configLoader.load(configPath);

    let config: RunConfig;
    try {
      config = RunConfigSchema.parse(raw);
    } catch (error) {
      throw new ConfigError(
        `Invalid config at ${configPath}: ${error instanceof ZodError ? error.message : String(error)}`,
        error,
      );
    }

    const projectPath = projectDir ?? dirname(configPath);
    const resolvedOutputDir = outputDir ?? await this.repo.createRunDir(config);

    return this.onboarding.execute(config, resolvedOutputDir, projectPath);
  }
}
