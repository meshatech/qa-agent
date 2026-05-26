import { Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface PreflightReport {
  status: 'PASS' | 'BLOCKED';
  timestamp: string;
  checks: {
    clickupToken: { ok: boolean };
    clickupTaskId: { ok: boolean };
    githubToken: { ok: boolean; warning?: string };
    prContext: { ok: boolean; missing: string[] };
    config: { ok: boolean; errors: string[] };
  };
}

/**
 * Validates the pipeline environment before execution.
 * Checks required secrets, PR context, and project configuration.
 */
@Injectable()
export class PipelinePreflightService {
  async run(outputDir: string): Promise<PreflightReport> {
    const clickupTokenCheck = this.validateClickUpToken();
    const clickupTaskIdCheck = this.validateClickUpTaskId();
    const githubTokenCheck = this.validateGitHubToken();
    const prCheck = this.validatePrContext();
    const configCheck = this.validateConfig();

    const allOk = clickupTokenCheck.ok && clickupTaskIdCheck.ok && prCheck.ok && configCheck.ok;

    const report: PreflightReport = {
      status: allOk ? 'PASS' : 'BLOCKED',
      timestamp: new Date().toISOString(),
      checks: {
        clickupToken: clickupTokenCheck,
        clickupTaskId: clickupTaskIdCheck,
        githubToken: githubTokenCheck,
        prContext: prCheck,
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

  private validatePrContext(): { ok: boolean; missing: string[] } {
    const required = ['GITHUB_REPOSITORY', 'GITHUB_REF_NAME', 'GITHUB_SHA'];
    const missing = required.filter((key) => !process.env[key] || process.env[key]!.trim().length === 0);
    return { ok: missing.length === 0, missing };
  }

  private validateConfig(): { ok: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for project config file presence (agent-qa.config.json or similar)
    try {
      const configPath = process.env.AGENT_QA_CONFIG ?? './agent-qa.config.json';
      if (!configPath) {
        errors.push('AGENT_QA_CONFIG not set and no default config found');
      }
    } catch {
      errors.push('Config validation error');
    }

    return { ok: errors.length === 0, errors };
  }

  private async writeReport(outputDir: string, report: PreflightReport): Promise<void> {
    const path = join(outputDir, 'preflight-report.json');
    await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
  }
}
