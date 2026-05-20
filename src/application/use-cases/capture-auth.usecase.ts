import { Inject, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { ConfigError } from '../../domain/errors.js';

@Injectable()
export class CaptureAuthUseCase {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject('ConfigLoaderPort') private readonly loader: ConfigLoaderPort,
  ) {}

  async execute(configPath: string, outputPath: string): Promise<{ ok: true; outputPath: string }> {
    let config;
    try {
      config = RunConfigSchema.parse(await this.loader.load(configPath));
    } catch (error) {
      throw new ConfigError(error instanceof ZodError ? error.message : String(error), error);
    }
    if (config.auth.kind !== 'formLogin') throw new ConfigError('capture-auth requires auth.kind=formLogin');
    try {
      await this.browser.captureAuth(config, outputPath);
    } finally {
      await this.browser.close().catch(() => undefined);
    }
    return { ok: true, outputPath };
  }
}
