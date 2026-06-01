import { Inject, Injectable } from '@nestjs/common';
import { writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionPlan } from '../../domain/schemas/execution-plan.schema.js';
import type { OnboardingResult, ProjectReadinessStatus } from '../../domain/models/readiness.model.js';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import { PlanExecutorService } from './plan-executor.service.js';
import { RunHistoryService } from './run-history.service.js';
import { DataHarnessService } from './data-harness.service.js';
import { ReadinessEvaluatorService } from './readiness-evaluator.service.js';
import { BaselineSmokeBuilderService } from './baseline-smoke-builder.service.js';

@Injectable()
export class ProjectOnboardingService {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject(PlanExecutorService) private readonly planExecutor: PlanExecutorService,
    @Inject(RunHistoryService) private readonly runHistory: RunHistoryService,
    @Inject(DataHarnessService) private readonly data: DataHarnessService,
    @Inject(ReadinessEvaluatorService) private readonly readinessEvaluator: ReadinessEvaluatorService,
    @Inject(BaselineSmokeBuilderService) private readonly smokeBuilder: BaselineSmokeBuilderService,
  ) {}

  async execute(config: RunConfig, outputDir: string, projectPath: string): Promise<OnboardingResult> {
    const startedAt = new Date().toISOString();
    const warnings: string[] = this.validateConfig(config);
    let readiness: ProjectReadinessStatus = 'UNKNOWN';
    let baselineReportPath: string | null = null;

    let browserOpenOk = false;
    let minimalSmokeOk = true;
    let routeCheckOk = true;
    let smokePlan: ExecutionPlan | null = null;
    let smokeResult: import('./plan-executor.service.js').PlanExecutionResult | null = null;
    let executionError = false;
    const accessibleRoutes: string[] = [];
    const blockedRoutes: string[] = [];

    try {
      await this.browser.open(config);
      browserOpenOk = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Browser open failed: ${message}`);
    }

    if (browserOpenOk) {
      const minimalSmoke = await this.verifyMinimalSmoke(config);
      minimalSmokeOk = minimalSmoke.ok;
      warnings.push(...minimalSmoke.warnings);

      const routeCheck = await this.verifyAllowedRoutes(config);
      routeCheckOk = routeCheck.blockedRoutes.length === 0;
      warnings.push(...routeCheck.warnings);
      accessibleRoutes.push(...routeCheck.accessibleRoutes);
      blockedRoutes.push(...routeCheck.blockedRoutes);

      try {
        smokePlan = this.smokeBuilder.build(config);
        smokeResult = await this.planExecutor.execute(smokePlan, config);

        warnings.push(...smokeResult.warnings.map((w) => `${w.stepId}: ${w.message}`));
        if (!smokeResult.ok && smokeResult.failedMessage) {
          warnings.push(`Onboarding failed: ${smokeResult.failedMessage}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        executionError = true;
        warnings.push(`Smoke execution error: ${message}`);
      } finally {
        await this.browser.close().catch(() => undefined);
      }
    }

    readiness = this.readinessEvaluator.evaluate({
      browserOpenOk,
      minimalSmokeOk,
      routeCheckOk,
      smokeResult,
      executionError,
    });

    if (smokePlan && smokeResult) {
      baselineReportPath = await this.writeBaselineReport(outputDir, config, smokePlan, smokeResult, readiness, warnings, startedAt, accessibleRoutes, blockedRoutes);
    }

    await this.persistResult(projectPath, outputDir, readiness, warnings, startedAt, accessibleRoutes, blockedRoutes);
    return { readiness, baselineReportPath, warnings };
  }

  private async verifyMinimalSmoke(config: RunConfig): Promise<{ ok: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    let ok = true;

    try {
      const observation = await this.browser.observe();

      // Verify HTTP 200 status for baseUrl navigation
      // Use full network log; observation.networkSignals is capped to last 50 which may
      // exclude the baseUrl signal when many third-party requests occur.
      const allNetworkSignals = this.browser.networkLog() as { url: string; status: number; isAppOrigin: boolean }[];
      const baseUrlSignal = allNetworkSignals.find(
        (s) => s.url === config.baseUrl || s.url.startsWith(config.baseUrl),
      );
      if (!baseUrlSignal) {
        warnings.push(`No network signal found for baseUrl ${config.baseUrl}`);
        ok = false;
      } else if (baseUrlSignal.status !== 200) {
        warnings.push(`baseUrl returned HTTP ${baseUrlSignal.status} (expected 200)`);
        ok = false;
      }

      // Verify DOM is loaded (has elements)
      if (observation.elements.length === 0) {
        warnings.push('DOM appears empty: no elements detected after navigation');
        ok = false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Minimal smoke verification failed: ${message}`);
      ok = false;
    }

    return { ok, warnings };
  }

  private async verifyAllowedRoutes(config: RunConfig): Promise<{ accessibleRoutes: string[]; blockedRoutes: string[]; warnings: string[] }> {
    const accessibleRoutes: string[] = [];
    const blockedRoutes: string[] = [];
    const warnings: string[] = [];

    if (!config.allowedRoutes || config.allowedRoutes.length === 0) {
      return { accessibleRoutes, blockedRoutes, warnings };
    }

    for (const route of config.allowedRoutes) {
      try {
        const fullUrl = new URL(route, config.baseUrl).toString();
        await this.browser.execute({ type: 'navigate', to: fullUrl, reason: `Onboarding: verify allowed route ${route}` });
        const observation = await this.browser.observe();

        const allNetworkSignals = this.browser.networkLog() as { url: string; status: number }[];
        const routeSignal = allNetworkSignals.find(
          (s) => s.url === fullUrl || s.url.startsWith(fullUrl),
        );
        if (!routeSignal) {
          warnings.push(`Route ${route}: no network signal found`);
          blockedRoutes.push(route);
        } else if (routeSignal.status !== 200) {
          warnings.push(`Route ${route} returned HTTP ${routeSignal.status} (expected 200)`);
          blockedRoutes.push(route);
        } else if (observation.elements.length === 0) {
          warnings.push(`Route ${route}: DOM empty after navigation`);
          blockedRoutes.push(route);
        } else {
          accessibleRoutes.push(route);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Route ${route} verification failed: ${message}`);
        blockedRoutes.push(route);
      }
    }

    return { accessibleRoutes, blockedRoutes, warnings };
  }

  private validateConfig(config: RunConfig): string[] {
    const warnings: string[] = [];

    // baseUrl must be a valid, non-empty URL
    try {
      const url = new URL(config.baseUrl);
      if (!url.protocol.startsWith('http')) {
        warnings.push(`baseUrl uses non-HTTP protocol: ${url.protocol}`);
      }
    } catch {
      warnings.push(`baseUrl is not a valid URL: ${config.baseUrl}`);
    }

    // appDomains should contain at least one domain
    if (config.appDomains.length === 0) {
      warnings.push('appDomains is empty; no domains configured for scope');
    }

    // Auth verification
    if (config.auth.kind === 'formLogin') {
      const username = process.env[config.auth.usernameEnv] ?? '';
      const password = process.env[config.auth.passwordEnv] ?? '';
      if (!username || !password) {
        warnings.push(`formLogin auth configured but credentials missing (env: ${config.auth.usernameEnv}, ${config.auth.passwordEnv})`);
      }
    }

    return warnings;
  }

  private async writeBaselineReport(
    outputDir: string,
    config: RunConfig,
    plan: ExecutionPlan,
    planResult: import('./plan-executor.service.js').PlanExecutionResult,
    readiness: ProjectReadinessStatus,
    warnings: string[],
    startedAt: string,
    accessibleRoutes: string[],
    blockedRoutes: string[],
  ): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    const path = join(outputDir, 'baseline-report.md');
    const lines: string[] = [
      '# Baseline Smoke Report',
      '',
      `**Project:** ${config.baseUrl}`,
      `**Readiness:** ${readiness}`,
      `**Started At:** ${startedAt}`,
      `**Finished At:** ${new Date().toISOString()}`,
      '',
      '## Smoke Plan',
      '',
      ...plan.steps.map((s) => `- ${s.id}: ${s.description}`),
      '',
      '## Execution Result',
      '',
      `- **OK:** ${planResult.ok}`,
      `- **Steps executed:** ${planResult.steps.length}`,
      `- **Warnings:** ${planResult.warnings.length}`,
      '',
      '## Routes',
      '',
      '### Accessible Routes',
      ...(accessibleRoutes.length ? accessibleRoutes.map((r) => `- ${r}`) : ['- None']),
      '',
      '### Blocked Routes',
      ...(blockedRoutes.length ? blockedRoutes.map((r) => `- ${r}`) : ['- None']),
      '',
      '## Warnings',
      ...(warnings.length ? warnings.map((w) => `- ${w}`) : ['- None']),
      '',
      '## Notes',
      '- Onboarding failures are classified as ONBOARDING_BLOCKED, not product bugs.',
      '- No destructive actions were attempted.',
      '- No sensitive credentials or tokens are included in this report.',
    ];

    await writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }

  private async persistResult(
    projectPath: string,
    outputDir: string,
    readiness: ProjectReadinessStatus,
    warnings: string[],
    startedAt: string,
    accessibleRoutes: string[],
    blockedRoutes: string[],
  ): Promise<void> {
    await this.writeReadinessStatus(projectPath, readiness);
    await this.runHistory.append(projectPath, {
      runId: `onboarding-${Date.now()}`,
      ts: startedAt,
      status: this.readinessEvaluator.toRunHistoryStatus(readiness),
      demandId: 'onboarding',
      summary: `Onboarding completed with readiness=${readiness}`,
      warnings,
      outputDir,
      readiness,
      accessibleRoutes,
      blockedRoutes,
    });
  }

  private async writeReadinessStatus(projectPath: string, readiness: ProjectReadinessStatus): Promise<void> {
    try {
      const dir = join(projectPath, '.agent-qa');
      await mkdir(dir, { recursive: true });
      const targetPath = join(dir, 'readiness.json');
      const tempPath = join(dir, `readiness.json.tmp.${Date.now()}`);
      const payload = {
        readiness,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
      renameSync(tempPath, targetPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to persist readiness status: ${message}`);
    }
  }

  async getReadinessStatus(projectPath: string): Promise<ProjectReadinessStatus | null> {
    try {
      const { readFile } = await import('node:fs/promises');
      const path = join(projectPath, '.agent-qa', 'readiness.json');
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as { readiness: ProjectReadinessStatus };
      return parsed.readiness;
    } catch {
      return null;
    }
  }
}
