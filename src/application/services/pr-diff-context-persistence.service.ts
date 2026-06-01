import { Inject, Injectable, Logger } from '@nestjs/common';

import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import type { GitHubActionsPrContextReaderPort } from '../ports/github-actions-pr-context-reader.port.js';
import type { PrDiffContextWriterPort } from '../ports/pr-diff-context-writer.port.js';
import { buildPrDiffContextFromReadResult } from '../mappers/pr-diff-context.mapper.js';
import { loadClickUpConfigSettings } from '../helpers/load-clickup-config-settings.js';
import {
  PrDiffContextSchema,
  type PrDiffContext,
} from '../../domain/schemas/pr-diff-context.schema.js';
import { resolveClickUpTaskIdReference } from '../../infra/clickup/clickup-task-id.resolver.js';
import { collectKnownSecretsFromEnv } from './known-secrets.collector.js';
import { SanitizerService } from './sanitizer.service.js';

const logger = new Logger('PrDiffContextPersistenceService');

export interface PrDiffContextPersistResult {
  path: string;
  context: PrDiffContext;
  tokensMasked: boolean;
}

@Injectable()
export class PrDiffContextPersistenceService {
  constructor(
    @Inject('PrDiffContextWriterPort')
    private readonly writer: PrDiffContextWriterPort,
    @Inject('GitHubActionsPrContextReaderPort')
    private readonly prContextReader: GitHubActionsPrContextReaderPort,
    @Inject('ConfigLoaderPort')
    private readonly configLoader: ConfigLoaderPort,
    @Inject(SanitizerService) private readonly sanitizer: SanitizerService,
  ) {}

  async persistFromGitHubActions(
    outputDir: string,
    options?: { cwd?: string; env?: NodeJS.ProcessEnv; knownSecrets?: string[] },
  ): Promise<PrDiffContextPersistResult> {
    const env = options?.env ?? process.env;
    const readResult = await this.prContextReader.read({
      cwd: options?.cwd,
      env,
    });
    const configTaskId = await this.resolveConfigTaskId(env);
    const pullRequest = await this.applyConfiguredTaskId(readResult.pullRequest, env, configTaskId);
    const built = buildPrDiffContextFromReadResult({
      ...readResult,
      pullRequest,
    });
    const validated = PrDiffContextSchema.parse(built);
    const secrets = collectKnownSecretsFromEnv(env, options?.knownSecrets ?? []);
    const preSanitizeLeakDetected = this.sanitizer.containsLeakedSecrets(
      JSON.stringify(validated),
      secrets,
    );
    const sanitized = this.sanitizer.sanitizeForOutput(validated, secrets);
    const postSanitizeLeakDetected = this.sanitizer.containsLeakedSecrets(
      JSON.stringify(sanitized),
      secrets,
    );
    if (preSanitizeLeakDetected) {
      logger.warn('Potential secret material detected in PR diff context before sanitization');
    }
    const tokensMasked = !postSanitizeLeakDetected;
    const path = await this.writer.write(outputDir, sanitized);
    return { path, context: sanitized, tokensMasked };
  }

  private async resolveConfigTaskId(env: NodeJS.ProcessEnv): Promise<string | undefined> {
    const settings = await loadClickUpConfigSettings(this.configLoader, env);
    return settings.taskId;
  }

  private async applyConfiguredTaskId(
    pullRequest: PrDiffContext['pullRequest'],
    env: NodeJS.ProcessEnv,
    configTaskId?: string,
  ): Promise<PrDiffContext['pullRequest']> {
    if (pullRequest.clickUpTaskId?.trim()) {
      return pullRequest;
    }

    try {
      const configured = resolveClickUpTaskIdReference({ env, configTaskId });
      return {
        ...pullRequest,
        clickUpTaskId: configured.taskId,
      };
    } catch {
      return pullRequest;
    }
  }
}
