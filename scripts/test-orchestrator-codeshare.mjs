#!/usr/bin/env node
/**
 * Teste direto do modo ORCHESTRATOR com CodeShare.
 * Não usa CLI — chama RunAgentUseCase diretamente para evitar problemas de bootstrap.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/src/app.module.js';
import { RunAgentUseCase } from '../dist/src/application/use-cases/run-agent.usecase.js';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const useCase = app.get(RunAgentUseCase);
    const result = await useCase.execute({
      configPath: '.agent-qa/codeshare-orchestrator.config.json',
    });
    console.log(JSON.stringify({ status: result.status, runDir: result.runDir }, null, 2));
    process.exit(result.status === 'PASSED' ? 0 : 1);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
