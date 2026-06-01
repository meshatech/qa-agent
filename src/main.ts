#!/usr/bin/env node
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import { AppModule } from './app.module.js';
import { AgentController } from './interfaces/cli/agent.controller.js';
import { ExitCodes as EXIT, classifyError, classifyPreflightReport, classifyCorrelationResult, classifyResult, classifyOnboardingResult } from './interfaces/cli/exit-codes.js';
import { CorrelationBlockedError, PreflightBlockedError } from './domain/errors.js';

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
  .command('preflight')
  .description('Run pipeline preflight checks and emit preflight-report.json')
  .option('--output-dir <path>', 'output directory for preflight-report.json', './.agent-qa/pipeline')
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.preflight(opts.outputDir));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = classifyPreflightReport(result.report);
    } catch (err) {
      if (err instanceof PreflightBlockedError) {
        console.log(JSON.stringify({ report: err.report, reportPath: err.reportPath ?? null }, null, 2));
        process.exitCode = classifyPreflightReport(err.report);
        return;
      }
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

program
  .command('read-pr-context')
  .description('Read GitHub Actions PR context and emit pr-diff-context.json')
  .option('--output-dir <path>', 'output directory for pr-diff-context.json', './.agent-qa/pipeline')
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.readPrContext(opts.outputDir));
      if (result.tokensMasked) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              contextPath: result.contextPath,
              tokensMasked: false,
              warning: 'PR diff context output redacted due to potential secret leak',
            },
            null,
            2,
          ),
        );
      }
      process.exitCode = EXIT.OK;
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

const pipeline = program.command('pipeline').description('Pipeline orchestration commands');

pipeline
  .command('prepare')
  .description('Run preflight checks then read PR diff context into the pipeline output dir')
  .option('--output-dir <path>', 'output directory for pipeline artifacts', './.agent-qa/pipeline')
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.pipelinePrepare(opts.outputDir));
      if (result.tokensMasked) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              preflightReportPath: result.preflightReportPath,
              prDiffContextPath: result.prDiffContextPath,
              tokensMasked: false,
              warning: 'PR diff context output redacted due to potential secret leak',
            },
            null,
            2,
          ),
        );
      }
      process.exitCode = classifyPreflightReport(result.preflightReport);
    } catch (err) {
      if (err instanceof PreflightBlockedError) {
        console.log(JSON.stringify({ report: err.report, reportPath: err.reportPath ?? null }, null, 2));
        process.exitCode = classifyPreflightReport(err.report);
        return;
      }
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

pipeline
  .command('correlate')
  .description('Correlate ClickUp demand, PR diff, and BM25 memory into required scenarios')
  .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
  .option('--project-dir <path>', 'project root for BM25 memory lookup', process.cwd())
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.pipelineCorrelate(opts.outputDir, opts.projectDir));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = classifyCorrelationResult(result.result);
    } catch (err) {
      if (err instanceof CorrelationBlockedError) {
        console.log(
          JSON.stringify(
            {
              result: err.result,
              requiredScenariosPath: err.requiredScenariosPath ?? null,
              correlationReportPath: err.correlationReportPath ?? null,
            },
            null,
            2,
          ),
        );
        process.exitCode = classifyCorrelationResult(err.result);
        return;
      }
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

pipeline
  .command('generate-plan')
  .description('Build ExecutionPlan from selected scenarios')
  .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
  .option('--config <path>', 'config path', './agent-qa.config.json')
  .option('--project-dir <path>', 'project root', process.cwd())
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.pipelineGeneratePlan(opts.outputDir, opts.config, opts.projectDir));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.executionPlanPath ? EXIT.OK : EXIT.CONFIG_ERROR;
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

pipeline
  .command('execute')
  .description('Execute ExecutionPlan via PlanExecutorService')
  .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
  .option('--config <path>', 'config path', './agent-qa.config.json')
  .option('--project-dir <path>', 'project root', process.cwd())
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.pipelineExecute(opts.outputDir, opts.config, opts.projectDir));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? EXIT.OK : EXIT.BUGS_FOUND;
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

pipeline
  .command('report')
  .description('Generate pipeline report from execution artifacts')
  .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
  .option('--config <path>', 'config path', './agent-qa.config.json')
  .option('--project-dir <path>', 'project root', process.cwd())
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.pipelineReport(opts.outputDir, opts.config, opts.projectDir));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.pipelineStatus === 'COMPLETED' ? EXIT.OK : (result.pipelineStatus === 'PARTIAL' ? EXIT.CONFIG_ERROR : EXIT.BUGS_FOUND);
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

pipeline
  .command('learning')
  .description('Generate learning candidates from execution artifacts')
  .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
  .option('--config <path>', 'config path', './agent-qa.config.json')
  .option('--project-dir <path>', 'project root', process.cwd())
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.pipelineLearning(opts.outputDir, opts.config, opts.projectDir));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.count > 0 ? EXIT.OK : EXIT.CONFIG_ERROR;
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

pipeline
  .command('generate-memory')
  .description('Generate memory.md from project diff and source analysis')
  .option('--project-dir <path>', 'project root', process.cwd())
  .option('--output-dir <path>', 'output directory for memory.md', './.agent-qa')
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.pipelineGenerateMemory(opts.projectDir, opts.outputDir));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.chunksGenerated > 0 ? EXIT.OK : EXIT.CONFIG_ERROR;
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = classifyError(err);
    }
  });

program
  .command('onboard')
  .description('Run project onboarding with baseline smoke test')
  .option('-c, --config <path>', 'config path', './agent-qa.config.json')
  .option('--project-dir <path>', 'project directory override')
  .option('--output-dir <path>', 'output directory override')
  .option('--headed', 'headed browser')
  .action(async (opts) => {
    try {
      const result = await withApp((c) => c.onboard(opts.config, opts.projectDir, opts.outputDir, Boolean(opts.headed)));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = classifyOnboardingResult(result);
    } catch (err) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), kind: err instanceof Error ? err.constructor.name : 'Error' }, null, 2));
      process.exitCode = EXIT.BUGS_FOUND;
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
