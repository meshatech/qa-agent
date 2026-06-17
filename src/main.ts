#!/usr/bin/env node
import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { CliCommand } from './cli/cli.command.js';

const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
const packageVersion = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string }).version;

// ── API mode ──────────────────────────────────────────────
async function startApi() {
  const logger = new Logger('Api');
  const port = Number(process.env.QA_AGENT_DAEMON_PORT ?? 3000);
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  await app.listen(port);
  logger.log(`HTTP server listening on port ${port}`);
  logger.log('Endpoints: GET /api/v1/health, POST /api/v1/run, GET /api/v1/jobs, GET /api/v1/jobs/:id, GET /api/v1/logs');
}

if (process.env.QA_AGENT_DAEMON === '1' || process.argv.includes('--daemon')) {
  const logger = new Logger('Api');
  startApi().catch((err: unknown) => {
    logger.error('Fatal:', err);
    process.exit(1);
  });
} else {
  // ── CLI mode ──────────────────────────────────────────
  async function bootstrapCli() {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    try {
      const cliCommand = app.get(CliCommand);
      const program = cliCommand.setup();
      program.name('qa-agent').description('Agent QA v0.1').version(packageVersion);
      await program.parseAsync(process.argv);
    } finally {
      await app.close();
    }
  }
  bootstrapCli().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
