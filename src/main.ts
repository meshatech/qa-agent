#!/usr/bin/env node
import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Command } from 'commander';
import { AppModule } from './app.module.js';
import { CliService } from './cli/cli.service.js';

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
  startApi().catch((err) => {
    logger.error('Fatal:', err);
    process.exit(1);
  });
} else {

// ── CLI mode ──────────────────────────────────────────────
async function withCli(fn: (cli: CliService) => Promise<{ output: string; exitCode: number }>): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const cli = app.get(CliService);
    const { output, exitCode } = await fn(cli);
    console.log(output);
    process.exitCode = exitCode;
  } finally {
    await app.close();
  }
}

const program = new Command();
program.name('qa-agent').description('Agent QA v0.1').version(packageVersion);

program
  .command('run')
  .option('-c, --config <path>', 'config path', './agent-qa.config.json')
  .option('--headed', 'headed browser')
  .option('--dry-run', 'dry run')
  .option('--demand <path>', 'demand markdown path')
  .option('--scenario <id>', 'scenario id')
  .option('--max-scenarios <n>', 'max scenarios', (v) => Number(v))
  .option('--seed <n>', 'data seed', (v) => Number(v))
  .option('--output-dir <path>', 'override runs dir')
  .option('--verbose', 'verbose output')
  .action(async (opts) => {
    await withCli((cli) => cli.run(opts));
  });

program
  .command('capture-auth')
  .option('-c, --config <path>', 'config path', './agent-qa.config.json')
  .option('-o, --output <path>', 'storage state path', './storage-state.json')
  .action(async (opts) => {
    await withCli((cli) => cli.captureAuth(opts));
  });

program
  .command('validate-config')
  .option('-c, --config <path>', 'config path', './agent-qa.config.json')
  .action(async (opts) => {
    await withCli((cli) => cli.validateConfig(opts));
  });

program
  .command('preflight')
  .description('Run pipeline preflight checks and emit preflight-report.json')
  .option('--output-dir <path>', 'output directory', './.agent-qa/pipeline')
  .action(async (opts) => {
    await withCli((cli) => cli.preflight(opts));
  });

program
  .command('read-pr-context')
  .description('Read GitHub Actions PR context and emit pr-diff-context.json')
  .option('--output-dir <path>', 'output directory', './.agent-qa/pipeline')
  .action(async (opts) => {
    await withCli((cli) => cli.readPrContext(opts));
  });

const pipeline = program.command('pipeline').description('Pipeline orchestration commands');

pipeline
  .command('all')
  .description('Run full QA pipeline with fail-fast gates')
  .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
  .option('--config <path>', 'config path', './agent-qa.config.json')
  .option('--project-dir <path>', 'project root', process.cwd())
  .action(async (opts) => {
    await withCli((cli) => cli.pipelineAll(opts));
  });

pipeline
  .command('prepare')
  .description('Run preflight checks then read PR diff context')
  .option('--output-dir <path>', 'output directory', './.agent-qa/pipeline')
  .action(async (opts) => {
    await withCli((cli) => cli.pipelinePrepare(opts));
  });

pipeline
  .command('correlate')
  .description('Correlate ClickUp demand, PR diff, and BM25 memory')
  .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
  .option('--project-dir <path>', 'project root', process.cwd())
  .action(async (opts) => {
    await withCli((cli) => cli.pipelineCorrelate(opts));
  });

program
  .command('onboard')
  .description('Run project onboarding with baseline smoke test')
  .option('-c, --config <path>', 'config path', './agent-qa.config.json')
  .option('--project-dir <path>', 'project directory override')
  .option('--output-dir <path>', 'output directory override')
  .option('--headed', 'headed browser')
  .action(async (opts) => {
    await withCli((cli) => cli.onboard(opts));
  });

program
  .command('inspect')
  .option('--runs-dir <path>', 'runs directory', './qa-agent-runs')
  .option('--run-id <id>', 'run directory id')
  .action(async (opts) => {
    await withCli((cli) => cli.inspect(opts));
  });

program
  .command('report')
  .option('--runs-dir <path>', 'runs directory', './qa-agent-runs')
  .option('--run-id <id>', 'run directory id')
  .option('--format <format>', 'report format (md|json)', 'md')
  .action(async (opts) => {
    await withCli((cli) => cli.report({ ...opts, format: opts.format === 'json' ? 'json' : 'md' }));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

}
