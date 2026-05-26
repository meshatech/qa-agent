import { Inject, Injectable } from '@nestjs/common';

import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import type { ClickUpApiPort, ClickUpReadAccessResult } from '../ports/clickup-api.port.js';
import type { GitHubApiPort, GitHubPrCommentPermissionResult } from '../ports/github-api.port.js';
import type { GitRepositoryPort } from '../ports/git-repository.port.js';
import type { PreflightReportWriterPort } from '../ports/preflight-report-writer.port.js';
import type { PipelinePreflightRunResult } from '../dto/pipeline-preflight-result.dto.js';
import { ValidateConfigUseCase } from '../use-cases/validate-config.usecase.js';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';
import {
  BLOCKING_PREFLIGHT_CHECKS,
  PREFLIGHT_CHECK_NAMES,
  PreflightReportSchema,
  type PreflightCheckItem,
  type PreflightCheckName,
  type PreflightChecksDetail,
  type PreflightReport,
} from '../../domain/schemas/preflight-report.schema.js';
import { ConfigError, PreflightBlockedError } from '../../domain/errors.js';
import { SanitizerService } from './sanitizer.service.js';

type PreflightCheckStatus = PreflightCheckItem['status'];

/**
 * Validates the pipeline environment before execution.
 * Checks required secrets, PR context, and project configuration.
 */
@Injectable()
export class PipelinePreflightService {
  constructor(
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
    @Inject('GitRepositoryPort') private readonly gitRepository: GitRepositoryPort,
    @Inject('ClickUpApiPort') private readonly clickUpApi: ClickUpApiPort,
    @Inject('GitHubApiPort') private readonly githubApi: GitHubApiPort,
    @Inject(SanitizerService) private readonly sanitizer: SanitizerService,
    @Inject(ValidateConfigUseCase) private readonly validateConfigUseCase: ValidateConfigUseCase,
    @Inject('PreflightReportWriterPort') private readonly reportWriter: PreflightReportWriterPort,
  ) {}

  async run(outputDir: string): Promise<PipelinePreflightRunResult> {
    const checks = await this.runChecks();
    const allOk = this.isBlockingChecksOk(checks);
    const report = this.buildPreflightReport(checks, allOk);
    const safeReport = this.sanitizeReport(report);
    const validated = PreflightReportSchema.parse(safeReport);
    const reportPath = await this.reportWriter.write(outputDir, validated);
    return { report: validated, reportPath };
  }

  async runOrThrow(outputDir: string): Promise<PipelinePreflightRunResult> {
    const result = await this.run(outputDir);
    if (result.report.status === 'BLOCKED') {
      throw new PreflightBlockedError(result.report, result.reportPath);
    }
    return result;
  }

  private async runChecks(): Promise<PreflightChecksDetail> {
    return {
      clickupToken: this.validateClickUpToken(),
      clickupReadAccess: await this.validateClickUpReadAccess(),
      clickupTaskId: this.validateClickUpTaskId(),
      githubToken: this.validateGitHubToken(),
      prCommentPermission: await this.validatePrCommentPermission(),
      prContext: this.validatePrContext(),
      branchHead: this.readBranchHead(),
      checkoutHistory: await this.validateCheckoutHistory(),
      config: await this.validateConfig(),
    };
  }

  private isBlockingChecksOk(checks: PreflightChecksDetail): boolean {
    return BLOCKING_PREFLIGHT_CHECKS.every((name) => checks[name].ok);
  }

  private buildPreflightReport(checks: PreflightChecksDetail, allOk: boolean): PreflightReport {
    return {
      schemaVersion: 'preflight-report.v1',
      status: allOk ? 'PASS' : 'BLOCKED',
      timestamp: new Date().toISOString(),
      tokensMasked: true,
      checkItems: PREFLIGHT_CHECK_NAMES.map((name) => this.buildCheckItem(name, checks)),
      checks,
    };
  }

  private buildCheckItem(name: PreflightCheckName, checks: PreflightChecksDetail): PreflightCheckItem {
    const warningChecks: PreflightCheckName[] = ['githubToken', 'prCommentPermission'];
    const raw = checks[name];
    const status: PreflightCheckStatus = raw.ok ? 'PASS' : warningChecks.includes(name) ? 'WARN' : 'FAIL';
    return { name, status, message: this.messageForCheck(name, checks) };
  }

  private messageForCheck(name: PreflightCheckName, checks: PreflightChecksDetail): string {
    switch (name) {
      case 'clickupToken':
        return checks.clickupToken.ok ? 'CLICKUP_TOKEN is configured' : 'CLICKUP_TOKEN is missing';
      case 'clickupReadAccess':
        return checks.clickupReadAccess.ok
          ? 'ClickUp read access verified'
          : (checks.clickupReadAccess.error ?? 'ClickUp read access check failed');
      case 'clickupTaskId':
        return checks.clickupTaskId.ok ? 'CLICKUP_TASK_ID is configured' : 'CLICKUP_TASK_ID is missing';
      case 'githubToken':
        return checks.githubToken.ok
          ? 'GITHUB_TOKEN is configured'
          : (checks.githubToken.warning ?? 'GITHUB_TOKEN is missing');
      case 'prCommentPermission':
        return checks.prCommentPermission.ok
          ? 'GitHub PR comment permission verified'
          : (checks.prCommentPermission.warning ?? 'GitHub PR comment permission check failed');
      case 'prContext':
        return checks.prContext.ok
          ? 'GitHub Actions pull_request context is complete'
          : `Missing PR context: ${checks.prContext.missing.join(', ')}`;
      case 'branchHead':
        return checks.branchHead.ok
          ? `Branch head resolved: ${checks.branchHead.branchHead}`
          : `Missing branch head: ${checks.branchHead.missing.join(', ')}`;
      case 'checkoutHistory':
        return checks.checkoutHistory.ok
          ? 'Checkout history is sufficient for git diff'
          : checks.checkoutHistory.errors.join('; ');
      case 'config':
        return checks.config.ok ? 'Project config is valid' : checks.config.errors.join('; ');
    }
  }

  private validateClickUpToken(): { ok: boolean } {
    const value = process.env.CLICKUP_TOKEN;
    return { ok: Boolean(value && value.trim().length > 0) };
  }

  private async validateClickUpReadAccess(): Promise<ClickUpReadAccessResult> {
    const token = process.env.CLICKUP_TOKEN?.trim() ?? '';
    if (!token) {
      return { ok: false, error: 'CLICKUP_TOKEN is missing; cannot verify read access' };
    }
    return this.clickUpApi.verifyReadAccess(token);
  }

  private validateClickUpTaskId(): { ok: boolean } {
    const value = process.env.CLICKUP_TASK_ID;
    return { ok: Boolean(value && value.trim().length > 0) };
  }

  private validateGitHubToken(): { ok: boolean; warning?: string } {
    const value = process.env.GITHUB_TOKEN;
    const present = Boolean(value && value.trim().length > 0);
    if (present) return { ok: true };
    return {
      ok: false,
      warning: 'GITHUB_TOKEN is missing; PR read/publish may be unavailable.',
    };
  }

  private resolvePullNumber(): number | undefined {
    const match = process.env.GITHUB_REF?.trim().match(/^refs\/pull\/(\d+)\//);
    return match ? Number(match[1]) : undefined;
  }

  private async validatePrCommentPermission(): Promise<GitHubPrCommentPermissionResult> {
    const token = process.env.GITHUB_TOKEN?.trim() ?? '';
    const repository = process.env.GITHUB_REPOSITORY?.trim() ?? '';
    const pullNumber = this.resolvePullNumber();

    if (!token) {
      return { ok: false, warning: 'GITHUB_TOKEN is missing; cannot verify PR comment permission' };
    }
    if (!repository || pullNumber === undefined) {
      return { ok: false, warning: 'PR metadata missing; cannot verify comment permission' };
    }

    const result = await this.githubApi.verifyPrCommentPermission({ token, repository, pullNumber });
    if (!result.ok && !result.warning) {
      return {
        ...result,
        warning: 'GitHub PR comment permission check failed; local fallback available',
        repository,
        pullNumber,
      };
    }
    return { ...result, repository, pullNumber };
  }

  private validatePrContext(): { ok: boolean; missing: string[]; eventName?: string } {
    const missing: string[] = [];
    const eventName = process.env.GITHUB_EVENT_NAME?.trim() ?? '';

    if (eventName !== 'pull_request') {
      missing.push('GITHUB_EVENT_NAME');
    }

    for (const key of ['GITHUB_REF', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF'] as const) {
      if (!process.env[key]?.trim()) {
        missing.push(key);
      }
    }

    return { ok: missing.length === 0, missing, eventName: eventName || undefined };
  }

  private readBranchHead(): { ok: boolean; branchHead?: string; missing: string[] } {
    const branchHead = process.env.GITHUB_HEAD_REF?.trim() ?? '';
    if (!branchHead) {
      return { ok: false, missing: ['GITHUB_HEAD_REF'] };
    }
    return { ok: true, branchHead, missing: [] };
  }

  private async validateCheckoutHistory(): Promise<{
    ok: boolean;
    errors: string[];
    baseRef?: string;
    shallow?: boolean;
  }> {
    const baseRef = process.env.GITHUB_BASE_REF?.trim() ?? '';
    const cwd = process.env.GITHUB_WORKSPACE?.trim() || process.cwd();
    const errors: string[] = [];

    if (!baseRef) {
      return { ok: false, errors: ['GITHUB_BASE_REF is missing'], shallow: false };
    }

    try {
      const shallow = await this.gitRepository.isShallowRepository(cwd);
      if (shallow) {
        errors.push('Checkout is shallow; fetch-depth: 0 required for git diff');
      }

      const baseAccessible = await this.gitRepository.hasRemoteBranch(baseRef, cwd);
      if (!baseAccessible) {
        errors.push(`Base branch not accessible locally: origin/${baseRef}`);
      }

      return { ok: errors.length === 0, errors, baseRef, shallow };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, errors: [`Git repository check failed: ${message}`], baseRef, shallow: false };
    }
  }

  private async validateConfig(): Promise<{ ok: boolean; errors: string[]; configPath?: string }> {
    const configPath = process.env.AGENT_QA_CONFIG?.trim() || './agent-qa.config.json';
    const errors: string[] = [];

    try {
      const raw = await this.configLoader.load(configPath);
      const parsed = RunConfigSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(...parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`));
        return { ok: false, errors, configPath };
      }

      try {
        await this.validateConfigUseCase.validateLoaded(parsed.data, { skipHealthCheck: true });
      } catch (error) {
        const message = error instanceof ConfigError ? error.message : String(error);
        errors.push(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(
        message.includes('ENOENT')
          ? `Config file not found: ${configPath}`
          : `Failed to load config from ${configPath}: ${message}`,
      );
    }

    return { ok: errors.length === 0, errors, configPath };
  }

  private collectKnownSecrets(): string[] {
    return [
      process.env.CLICKUP_TOKEN,
      process.env.GITHUB_TOKEN,
      process.env.CLICKUP_TASK_ID,
    ].flatMap((value) => {
      const trimmed = value?.trim() ?? '';
      return trimmed.length > 0 ? [trimmed] : [];
    });
  }

  private sanitizeReport(report: PreflightReport): PreflightReport {
    const sanitized = this.sanitizer.sanitizeForOutput(report, this.collectKnownSecrets());
    return { ...sanitized, tokensMasked: true as const };
  }
}
