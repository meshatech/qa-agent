import { Inject, Injectable } from '@nestjs/common';

import type { GitHubActionsPrContextReaderPort } from '../ports/github-actions-pr-context-reader.port.js';
import type { PrDiffContextWriterPort } from '../ports/pr-diff-context-writer.port.js';
import {
  PrDiffContextSchema,
  buildPrDiffContextFromReadResult,
  type PrDiffContext,
} from '../../domain/schemas/pr-diff-context.schema.js';
import { SanitizerService } from './sanitizer.service.js';

export interface PrDiffContextPersistResult {
  path: string;
  context: PrDiffContext;
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
    const sanitized = this.sanitizer.sanitizeForOutput(validated, options?.knownSecrets ?? []);
    const path = await this.writer.write(outputDir, sanitized);
    return { path, context: sanitized };
  }
}
