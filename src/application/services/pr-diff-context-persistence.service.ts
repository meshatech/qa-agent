import { Inject, Injectable, Logger } from '@nestjs/common';

import type { GitHubActionsPrContextReaderPort } from '../ports/github-actions-pr-context-reader.port.js';
import type { PrDiffContextWriterPort } from '../ports/pr-diff-context-writer.port.js';
import { buildPrDiffContextFromReadResult } from '../mappers/pr-diff-context.mapper.js';
import {
  PrDiffContextSchema,
  type PrDiffContext,
} from '../../domain/schemas/pr-diff-context.schema.js';
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
    @Inject(SanitizerService) private readonly sanitizer: SanitizerService,
  ) {}

  async persistFromGitHubActions(
    outputDir: string,
    options?: { cwd?: string; env?: NodeJS.ProcessEnv; knownSecrets?: string[] },
  ): Promise<PrDiffContextPersistResult> {
    const readResult = await this.prContextReader.read({
      cwd: options?.cwd,
      env: options?.env,
    });
    const built = buildPrDiffContextFromReadResult(readResult);
    const validated = PrDiffContextSchema.parse(built);
    const env = options?.env ?? process.env;
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
}
