import { Injectable, Logger } from '@nestjs/common';
import { CliService } from '../cli/cli.service.js';
import { ApiJob } from './models/index.js';

@Injectable()
export class ApiService {
  private readonly logger = new Logger(ApiService.name);
  private jobs = new Map<string, ApiJob>();
  private logBuffer: string[] = [];
  private maxLogs = 1000;

  constructor(private readonly cli: CliService) {}

  private log(level: string, message: string): void {
    const entry = `[${new Date().toISOString()}] [${level}] ${message}`;
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxLogs) {
      this.logBuffer.shift();
    }
    this.logger.log(message);
  }

  getLogs(tail = 100): string[] {
    return this.logBuffer.slice(-tail);
  }

  getJobs(): ApiJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''),
    );
  }

  getJob(id: string): ApiJob | undefined {
    return this.jobs.get(id);
  }

  async runCommand(command: string, args: Record<string, unknown>): Promise<ApiJob> {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const job: ApiJob = {
      id,
      command,
      args,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.jobs.set(id, job);
    this.log('INFO', `Job ${id} started: ${command}`);

    try {
      switch (command) {
        case 'run':
          job.output = (await this.cli.run({
            config: (args.config as string) ?? './agent-qa.config.json',
            headed: Boolean(args.headed),
            dryRun: Boolean(args.dryRun),
            demand: args.demand as string | undefined,
            scenario: args.scenario as string | undefined,
            maxScenarios: args.maxScenarios as number | undefined,
            seed: args.seed as number | undefined,
            outputDir: args.outputDir as string | undefined,
            verbose: Boolean(args.verbose),
          })).output;
          break;
        case 'capture-auth':
          job.output = (await this.cli.captureAuth({
            config: (args.config as string) ?? './agent-qa.config.json',
            output: (args.output as string) ?? './storage-state.json',
          })).output;
          break;
        case 'validate-config':
          job.output = (await this.cli.validateConfig({
            config: (args.config as string) ?? './agent-qa.config.json',
          })).output;
          break;
        case 'preflight':
          job.output = (await this.cli.preflight({
            outputDir: (args.outputDir as string) ?? './.agent-qa/pipeline',
          })).output;
          break;
        case 'read-pr-context':
          job.output = (await this.cli.readPrContext({
            outputDir: (args.outputDir as string) ?? './.agent-qa/pipeline',
          })).output;
          break;
        case 'pipeline-all':
          job.output = (await this.cli.pipelineAll({
            outputDir: (args.outputDir as string) ?? './.agent-qa/pipeline',
            config: (args.config as string) ?? './agent-qa.config.json',
            projectDir: (args.projectDir as string) ?? process.cwd(),
          })).output;
          break;
        case 'pipeline-prepare':
          job.output = (await this.cli.pipelinePrepare({
            outputDir: (args.outputDir as string) ?? './.agent-qa/pipeline',
          })).output;
          break;
        case 'pipeline-correlate':
          job.output = (await this.cli.pipelineCorrelate({
            outputDir: (args.outputDir as string) ?? './.agent-qa/pipeline',
            projectDir: (args.projectDir as string) ?? process.cwd(),
          })).output;
          break;
        case 'onboard':
          job.output = (await this.cli.onboard({
            config: (args.config as string) ?? './agent-qa.config.json',
            projectDir: args.projectDir as string | undefined,
            outputDir: args.outputDir as string | undefined,
            headed: Boolean(args.headed),
          })).output;
          break;
        case 'inspect':
          job.output = (await this.cli.inspect({
            runsDir: (args.runsDir as string) ?? './qa-agent-runs',
            runId: args.runId as string | undefined,
          })).output;
          break;
        case 'report':
          job.output = (await this.cli.report({
            runsDir: (args.runsDir as string) ?? './qa-agent-runs',
            runId: args.runId as string | undefined,
            format: (args.format as 'md' | 'json') ?? 'md',
          })).output;
          break;
        default:
          throw new Error(`Unknown command: ${command}`);
      }
      job.status = 'success';
      job.exitCode = 0;
      this.log('INFO', `Job ${id} succeeded: ${command}`);
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      job.exitCode = 1;
      this.log('ERROR', `Job ${id} failed: ${job.error}`);
    } finally {
      job.finishedAt = new Date().toISOString();
    }

    return job;
  }
}
