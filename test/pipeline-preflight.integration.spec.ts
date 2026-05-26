import { describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';

import { ApplicationModule } from '../src/application/application.module.js';
import { PipelinePreflightService } from '../src/application/services/pipeline-preflight.service.js';
import { RunPipelinePreflightUseCase } from '../src/application/use-cases/run-pipeline-preflight.usecase.js';

describe('Pipeline preflight Nest integration', () => {
  it('resolves PipelinePreflightService and RunPipelinePreflightUseCase from ApplicationModule', async () => {
    const app = await NestFactory.createApplicationContext(ApplicationModule, { logger: false });
    try {
      const service = app.get(PipelinePreflightService);
      const useCase = app.get(RunPipelinePreflightUseCase);

      expect(service).toBeInstanceOf(PipelinePreflightService);
      expect(useCase).toBeInstanceOf(RunPipelinePreflightUseCase);
      expect(typeof service.run).toBe('function');
      expect(typeof service.runOrThrow).toBe('function');
      expect(typeof useCase.execute).toBe('function');
    } finally {
      await app.close();
    }
  });
});
