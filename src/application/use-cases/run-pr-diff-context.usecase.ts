import { Inject, Injectable } from '@nestjs/common';

import type { PrDiffContextRunResult } from '../dto/pr-diff-context-result.dto.js';
import { PrDiffContextPersistenceService } from '../services/pr-diff-context-persistence.service.js';

@Injectable()
export class RunPrDiffContextUseCase {
  constructor(
    @Inject(PrDiffContextPersistenceService)
    private readonly persistence: PrDiffContextPersistenceService,
  ) {}

  execute(
    outputDir: string,
    options?: { cwd?: string; env?: NodeJS.ProcessEnv; knownSecrets?: string[] },
  ): Promise<PrDiffContextRunResult> {
    return this.persistence.persistFromGitHubActions(outputDir, options).then(({ path, context }) => ({
      context,
      contextPath: path,
    }));
  }
}
