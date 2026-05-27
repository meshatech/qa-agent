import { describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';

import { ApplicationModule } from '../src/application/application.module.js';
import { PrDiffContextPersistenceService } from '../src/application/services/pr-diff-context-persistence.service.js';
import { RunPrDiffContextUseCase } from '../src/application/use-cases/run-pr-diff-context.usecase.js';

describe('PR diff context Nest integration', () => {
  it('resolves PrDiffContextPersistenceService and RunPrDiffContextUseCase from ApplicationModule', async () => {
    const app = await NestFactory.createApplicationContext(ApplicationModule, { logger: false });
    try {
      const service = app.get(PrDiffContextPersistenceService);
      const useCase = app.get(RunPrDiffContextUseCase);

      expect(service).toBeInstanceOf(PrDiffContextPersistenceService);
      expect(useCase).toBeInstanceOf(RunPrDiffContextUseCase);
      expect(typeof service.persistFromGitHubActions).toBe('function');
      expect(typeof useCase.execute).toBe('function');
    } finally {
      await app.close();
    }
  });
});
