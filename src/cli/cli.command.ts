import { Injectable } from '@nestjs/common';
import { Command } from 'commander';
import { CliService } from './cli.service.js';

@Injectable()
export class CliCommand {
  constructor(private readonly cli: CliService) {}

  setup(): Command {
    const program = new Command();

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
        const { output, exitCode } = await this.cli.run(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    program
      .command('capture-auth')
      .option('-c, --config <path>', 'config path', './agent-qa.config.json')
      .option('-o, --output <path>', 'storage state path', './storage-state.json')
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.captureAuth(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    program
      .command('validate-config')
      .option('-c, --config <path>', 'config path', './agent-qa.config.json')
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.validateConfig(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    program
      .command('preflight')
      .description('Run pipeline preflight checks and emit preflight-report.json')
      .option('--output-dir <path>', 'output directory', './.agent-qa/pipeline')
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.preflight(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    program
      .command('read-pr-context')
      .description('Read GitHub Actions PR context and emit pr-diff-context.json')
      .option('--output-dir <path>', 'output directory', './.agent-qa/pipeline')
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.readPrContext(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    const pipeline = program.command('pipeline').description('Pipeline orchestration commands');

    pipeline
      .command('all')
      .description('Run full QA pipeline with fail-fast gates')
      .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
      .option('--config <path>', 'config path', './agent-qa.config.json')
      .option('--project-dir <path>', 'project root', process.cwd())
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.pipelineAll(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    pipeline
      .command('prepare')
      .description('Run preflight checks then read PR diff context')
      .option('--output-dir <path>', 'output directory', './.agent-qa/pipeline')
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.pipelinePrepare(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    pipeline
      .command('correlate')
      .description('Correlate ClickUp demand, PR diff, and BM25 memory')
      .option('--output-dir <path>', 'pipeline artifacts directory', './.agent-qa/pipeline')
      .option('--project-dir <path>', 'project root', process.cwd())
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.pipelineCorrelate(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    program
      .command('onboard')
      .description('Run project onboarding with baseline smoke test')
      .option('-c, --config <path>', 'config path', './agent-qa.config.json')
      .option('--project-dir <path>', 'project directory override')
      .option('--output-dir <path>', 'output directory override')
      .option('--headed', 'headed browser')
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.onboard(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    program
      .command('inspect')
      .option('--runs-dir <path>', 'runs directory', './qa-agent-runs')
      .option('--run-id <id>', 'run directory id')
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.inspect(opts);
        console.log(output);
        process.exitCode = exitCode;
      });

    program
      .command('report')
      .option('--runs-dir <path>', 'runs directory', './qa-agent-runs')
      .option('--run-id <id>', 'run directory id')
      .option('--format <format>', 'report format (md|json)', 'md')
      .action(async (opts) => {
        const { output, exitCode } = await this.cli.report({ ...opts, format: opts.format === 'json' ? 'json' : 'md' });
        console.log(output);
        process.exitCode = exitCode;
      });

    return program;
  }
}
