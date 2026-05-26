import { Inject, Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';

export interface PreflightReport {
  status: 'PASS' | 'BLOCKED';
  timestamp: string;
  checks: {
    clickupToken: { ok: boolean };
    clickupTaskId: { ok: boolean };
    githubToken: { ok: boolean; warning?: string };
    prContext: { ok: boolean; missing: string[]; eventName?: string };
    branchHead: { ok: boolean; branchHead?: string; missing: string[] };
    config: { ok: boolean; errors: string[]; configPath?: string };
  };
}

/**
 * Validates the pipeline environment before execution.
 * Checks required secrets, PR context, and project configuration.
 */
@Injectable()
export class PipelinePreflightService {
  constructor(@Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort) {}

  async run(outputDir: string): Promise<PreflightReport> {
    const clickupTokenCheck = this.validateClickUpToken();
    const clickupTaskIdCheck = this.validateClickUpTaskId();
    const githubTokenCheck = this.validateGitHubToken();
    const prCheck = this.validatePrContext();
    const branchHeadCheck = this.readBranchHead();
    const configCheck = await this.validateConfig();

    const allOk =
      clickupTokenCheck.ok &&
      clickupTaskIdCheck.ok &&
      prCheck.ok &&
      branchHeadCheck.ok &&
      configCheck.ok;

    const report: PreflightReport = {
      status: allOk ? 'PASS' : 'BLOCKED',
      timestamp: new Date().toISOString(),
      checks: {
        clickupToken: clickupTokenCheck,
        clickupTaskId: clickupTaskIdCheck,
        githubToken: githubTokenCheck,
        prContext: prCheck,
        branchHead: branchHeadCheck,
        config: configCheck,
      },
    };

    await this.writeReport(outputDir, report);
    return report;
  }

  private validateClickUpToken(): { ok: boolean } {
    const value = process.env.CLICKUP_TOKEN;
    return { ok: Boolean(value && value.trim().length > 0) };
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

  private async writeReport(outputDir: string, report: PreflightReport): Promise<void> {
    const path = join(outputDir, 'preflight-report.json');
    await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
  }
}
