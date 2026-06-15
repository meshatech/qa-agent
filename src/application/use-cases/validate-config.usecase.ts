import { Inject, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { RunConfigSchema, type RunConfig } from '../../domain/schemas/config.schema.js';
import { ConfigError } from '../../domain/errors.js';
import { applyBaseUrlOverride } from '../helpers/apply-base-url-override.js';

@Injectable()
export class ValidateConfigUseCase {
  constructor(@Inject('ConfigLoaderPort') private readonly loader: ConfigLoaderPort) {}

  async execute(configPath: string): Promise<RunConfig> {
    let raw: unknown;
    try {
      raw = await this.loader.load(configPath);
    } catch (error) {
      throw new ConfigError(`Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    let config: RunConfig;
    try {
      config = RunConfigSchema.parse(raw);
      config = applyBaseUrlOverride(config);
    } catch (error) {
      throw new ConfigError(error instanceof ZodError ? error.message : String(error), error);
    }

    await this.validateLoaded(config);
    return config;
  }

  async validateLoaded(config: RunConfig, options?: { skipHealthCheck?: boolean }): Promise<void> {
    if (config.llm.provider !== 'fake' && !process.env[config.llm.apiKeyEnv]) {
      throw new ConfigError(`Missing env ${config.llm.apiKeyEnv} for llm.provider=${config.llm.provider}`);
    }
    if (config.llm.fallbackProvider && config.llm.fallbackApiKeyEnv && !process.env[config.llm.fallbackApiKeyEnv]) {
      throw new ConfigError(`Missing env ${config.llm.fallbackApiKeyEnv} for llm.fallbackProvider=${config.llm.fallbackProvider}`);
    }
    if (config.auth.kind === 'formLogin') {
      for (const key of [config.auth.usernameEnv, config.auth.passwordEnv]) {
        if (!process.env[key]) throw new ConfigError(`Missing env ${key} for formLogin auth`);
      }
    }
    if (options?.skipHealthCheck) return;
    const res = await fetch(config.baseUrl, { method: 'HEAD' }).catch(() => undefined);
    if (res && res.status >= 500) throw new ConfigError(`baseUrl health check failed: ${res.status}`);
  }
}
