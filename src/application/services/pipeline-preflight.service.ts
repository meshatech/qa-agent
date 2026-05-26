import { Inject, Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import type { ClickUpApiPort, ClickUpReadAccessResult } from '../ports/clickup-api.port.js';
import type { GitHubApiPort, GitHubPrCommentPermissionResult } from '../ports/github-api.port.js';
import type { GitRepositoryPort } from '../ports/git-repository.port.js';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';
import { SanitizerService } from './sanitizer.service.js';

export interface PreflightReport {
  status: 'PASS' | 'BLOCKED';
  timestamp: string;
  checks: {
    clickupToken: { ok: boolean };
    clickupReadAccess: { ok: boolean; statusCode?: number; error?: string };
    clickupTaskId: { ok: boolean };
    githubToken: { ok: boolean; warning?: string };
    prCommentPermission: {
      ok: boolean;
      statusCode?: number;
      warning?: string;
      repository?: string;
      pullNumber?: number;
    };
    prContext: { ok: boolean; missing: string[]; eventName?: string };
    branchHead: { ok: boolean; branchHead?: string; missing: string[] };
    checkoutHistory: { ok: boolean; errors: string[]; baseRef?: string; shallow?: boolean };
    config: { ok: boolean; errors: string[]; configPath?: string };
  };
}

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
  ) {}

  async run(outputDir: string): Promise<PreflightReport> {
    const clickupTokenCheck = this.validateClickUpToken();
    const clickupReadAccessCheck = await this.validateClickUpReadAccess();
    const clickupTaskIdCheck = this.validateClickUpTaskId();
    const githubTokenCheck = this.validateGitHubToken();
    const prCommentPermissionCheck = await this.validatePrCommentPermission();
    const prCheck = this.validatePrContext();
    const branchHeadCheck = this.readBranchHead();
    const checkoutHistoryCheck = await this.validateCheckoutHistory();
    const configCheck = await this.validateConfig();

    const allOk =
      clickupTokenCheck.ok &&
      clickupReadAccessCheck.ok &&
      clickupTaskIdCheck.ok &&
      prCheck.ok &&
      branchHeadCheck.ok &&
      checkoutHistoryCheck.ok &&
      configCheck.ok;

    const report: PreflightReport = {
      status: allOk ? 'PASS' : 'BLOCKED',
      timestamp: new Date().toISOString(),
      checks: {
        clickupToken: clickupTokenCheck,
        clickupReadAccess: clickupReadAccessCheck,
        clickupTaskId: clickupTaskIdCheck,
        githubToken: githubTokenCheck,
        prCommentPermission: prCommentPermissionCheck,
        prContext: prCheck,
        branchHead: branchHeadCheck,
        checkoutHistory: checkoutHistoryCheck,
        config: configCheck,
      },
    };

    const safeReport = this.sanitizeReport(report);
    await this.writeReport(outputDir, safeReport);
    return safeReport;
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
    return this.sanitizer.sanitizeForOutput(report, this.collectKnownSecrets());
  }

  private logPreflight(message: string): void {
    console.log(this.sanitizer.sanitizeForOutput(message, this.collectKnownSecrets()));
  }

  private async writeReport(outputDir: string, report: PreflightReport): Promise<void> {
    const path = join(outputDir, 'preflight-report.json');
    await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
    this.logPreflight(`Preflight ${report.status} → preflight-report.json`);
  }
}
