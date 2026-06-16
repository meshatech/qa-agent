import { Injectable, Logger } from '@nestjs/common';
import { AgentController } from '../interfaces/cli/agent.controller.js';
import { ExitCodes as EXIT, classifyError, classifyPreflightReport, classifyCorrelationResult, classifyResult, classifyOnboardingResult } from '../interfaces/cli/exit-codes.js';
import { CorrelationBlockedError, PreflightBlockedError, LlmProviderError } from '../domain/errors.js';
import { formatPipelineAllSummary } from '../application/helpers/format-pipeline-all-summary.js';

function formatCliError(err: unknown): { error: string; kind: string; suggestion?: string } {
  if (err instanceof LlmProviderError) {
    return {
      error: err.message,
      kind: 'LlmProviderError',
      suggestion: err.statusCode === 429
        ? 'Dica: configure fallbackProvider no config para alternativa automatica, ou aguarde antes de tentar novamente.'
        : err.statusCode === 401 || err.statusCode === 403
          ? 'Dica: verifique se a variavel de ambiente da API key esta definida e valida.'
          : 'Dica: verifique sua conexao com a internet e as configuracoes do provider no config.',
    };
  }
  return {
    error: err instanceof Error ? err.message : String(err),
    kind: err instanceof Error ? err.constructor.name : 'Error',
  };
}

@Injectable()
export class CliService {
  private readonly logger = new Logger(CliService.name);

  constructor(private readonly agent: AgentController) {}

  // ── run ──────────────────────────────────────────────
  async run(opts: {
    config: string;
    headed?: boolean;
    dryRun?: boolean;
    demand?: string;
    scenario?: string;
    maxScenarios?: number;
    seed?: number;
    outputDir?: string;
    verbose?: boolean;
  }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.run({
        configPath: opts.config,
        headed: opts.headed,
        dryRun: Boolean(opts.dryRun),
        demandPath: opts.demand,
        outputDir: opts.outputDir,
        scenarioId: opts.scenario,
        maxScenarios: opts.maxScenarios,
        seed: opts.seed,
        verbose: Boolean(opts.verbose),
      });
      const output = JSON.stringify(result, null, 2);
      return { output, exitCode: classifyResult(result) };
    } catch (err) {
      const output = JSON.stringify(formatCliError(err), null, 2);
      return { output, exitCode: classifyError(err) };
    }
  }

  // ── capture-auth ─────────────────────────────────────
  async captureAuth(opts: { config: string; output: string }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.captureAuth(opts.config, opts.output);
      return { output: JSON.stringify(result, null, 2), exitCode: EXIT.OK };
    } catch (err) {
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: classifyError(err) };
    }
  }

  // ── validate-config ──────────────────────────────────
  async validateConfig(opts: { config: string }): Promise<{ output: string; exitCode: number }> {
    try {
      const config = await this.agent.validateConfig(opts.config);
      return { output: JSON.stringify({ ok: true, config }, null, 2), exitCode: EXIT.OK };
    } catch (err) {
      return { output: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2), exitCode: classifyError(err) };
    }
  }

  // ── preflight ──────────────────────────────────────
  async preflight(opts: { outputDir: string }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.preflight(opts.outputDir);
      return { output: JSON.stringify(result, null, 2), exitCode: classifyPreflightReport(result.report) };
    } catch (err) {
      if (err instanceof PreflightBlockedError) {
        return { output: JSON.stringify({ report: err.report, reportPath: err.reportPath ?? null }, null, 2), exitCode: classifyPreflightReport(err.report) };
      }
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: classifyError(err) };
    }
  }

  // ── read-pr-context ──────────────────────────────────
  async readPrContext(opts: { outputDir: string }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.readPrContext(opts.outputDir);
      const output = result.tokensMasked
        ? JSON.stringify(result, null, 2)
        : JSON.stringify({ contextPath: result.contextPath, tokensMasked: false, warning: 'PR diff context output redacted due to potential secret leak' }, null, 2);
      return { output, exitCode: EXIT.OK };
    } catch (err) {
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: classifyError(err) };
    }
  }

  // ── pipeline all ─────────────────────────────────────
  async pipelineAll(opts: { outputDir: string; config: string; projectDir: string }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.pipelineAll(opts.outputDir, opts.config, opts.projectDir);
      const output = JSON.stringify(result, null, 2) + '\n' + formatPipelineAllSummary(result);
      return { output, exitCode: result.exitCode };
    } catch (err) {
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: classifyError(err) };
    }
  }

  // ── pipeline prepare ─────────────────────────────────
  async pipelinePrepare(opts: { outputDir: string }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.pipelinePrepare(opts.outputDir);
      const output = result.tokensMasked
        ? JSON.stringify(result, null, 2)
        : JSON.stringify({ preflightReportPath: result.preflightReportPath, prDiffContextPath: result.prDiffContextPath, tokensMasked: false, warning: 'PR diff context output redacted due to potential secret leak' }, null, 2);
      return { output, exitCode: classifyPreflightReport(result.preflightReport) };
    } catch (err) {
      if (err instanceof PreflightBlockedError) {
        return { output: JSON.stringify({ report: err.report, reportPath: err.reportPath ?? null }, null, 2), exitCode: classifyPreflightReport(err.report) };
      }
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: classifyError(err) };
    }
  }

  // ── pipeline correlate ─────────────────────────────
  async pipelineCorrelate(opts: { outputDir: string; projectDir: string }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.pipelineCorrelate(opts.outputDir, opts.projectDir);
      return { output: JSON.stringify(result, null, 2), exitCode: classifyCorrelationResult(result.result) };
    } catch (err) {
      if (err instanceof CorrelationBlockedError) {
        return { output: JSON.stringify({ result: err.result, requiredScenariosPath: err.requiredScenariosPath ?? null, correlationReportPath: err.correlationReportPath ?? null }, null, 2), exitCode: classifyCorrelationResult(err.result) };
      }
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: classifyError(err) };
    }
  }

  // ── onboard ──────────────────────────────────────────
  async onboard(opts: { config: string; projectDir?: string; outputDir?: string; headed?: boolean }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.onboard(opts.config, opts.projectDir, opts.outputDir, Boolean(opts.headed));
      return { output: JSON.stringify(result, null, 2), exitCode: classifyOnboardingResult(result) };
    } catch (err) {
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: EXIT.BUGS_FOUND };
    }
  }

  // ── inspect ──────────────────────────────────────────
  async inspect(opts: { runsDir: string; runId?: string }): Promise<{ output: string; exitCode: number }> {
    try {
      const result = await this.agent.inspect(opts.runsDir, opts.runId);
      return { output: JSON.stringify(result, null, 2), exitCode: EXIT.OK };
    } catch (err) {
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: EXIT.HARNESS_FATAL };
    }
  }

  // ── report ───────────────────────────────────────────
  async report(opts: { runsDir: string; runId?: string; format: 'md' | 'json' }): Promise<{ output: string; exitCode: number }> {
    try {
      const out = await this.agent.reportWithFormat(opts.runsDir, opts.runId, opts.format);
      const output = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
      return { output, exitCode: EXIT.OK };
    } catch (err) {
      return { output: JSON.stringify(formatCliError(err), null, 2), exitCode: EXIT.HARNESS_FATAL };
    }
  }
}
