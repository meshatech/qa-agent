#!/usr/bin/env node
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import { AppModule } from './app.module.js';
import { AgentController } from './interfaces/cli/agent.controller.js';
import { ExitCodes as EXIT, classifyError, classifyResult } from './interfaces/cli/exit-codes.js';

async function withApp<T>(fn: (controller: AgentController) => Promise<T>): Promise<T> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    return await fn(app.get(AgentController));
  } finally {
    await app.close();
  }
}

const program = new Command();
program.name('qa-agent').description('Agent QA v0.1');

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
    try {
      const result = await withApp((c) =>
        c.run({
          configPath: opts.config,
          headed: opts.headed,
          dryRun: Boolean(opts.dryRun),
          demandPath: opts.demand,
          outputDir: opts.outputDir,
          scenarioId: opts.scenario,
          maxScenarios: opts.maxScenarios,
          seed: opts.seed,
          verbose: Boolean(opts.verbose),
        }),
      );
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = classifyResult(result);
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

program
  .command('capture-auth')
  .option('-c, --config <path>', 'config path', './agent-qa.config.json')
  .option('-o, --output <path>', 'storage state path', './storage-state.json')
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.captureAuth(opts.config, opts.output));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = EXIT.OK;
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

program
  .command('validate-config')
  .option('-c, --config <path>', 'config path', './agent-qa.config.json')
  .action(async (opts) => {
    try {
      const config = await withApp((c) => c.validateConfig(opts.config));
      console.log(JSON.stringify({ ok: true, config }, null, 2));
      process.exitCode = EXIT.OK;
    } catch (err) {
      console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

program
  .command('inspect')
  .option('--runs-dir <path>', 'runs directory', './qa-agent-runs')
  .option('--run-id <id>', 'run directory id')
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.inspect(opts.runsDir, opts.runId));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = EXIT.OK;
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
      process.exitCode = EXIT.HARNESS_FATAL;
    }
  });

program
  .command('report')
  .option('--runs-dir <path>', 'runs directory', './qa-agent-runs')
  .option('--run-id <id>', 'run directory id')
  .option('--format <format>', 'report format (md|json)', 'md')
  .action(async (opts) => {
    try {
      const format = opts.format === 'json' ? 'json' : 'md';
      const out = await withApp((c) => c.reportWithFormat(opts.runsDir, opts.runId, format));
      if (format === 'json') console.log(JSON.stringify(out, null, 2));
      else console.log(out);
      process.exitCode = EXIT.OK;
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
      process.exitCode = EXIT.HARNESS_FATAL;
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
  process.exitCode = classifyError(err);
});
