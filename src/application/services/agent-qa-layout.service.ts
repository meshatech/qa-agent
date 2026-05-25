import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

export interface EnsureAgentQaDirectoryResult {
  dir: string;
  created: boolean;
  warnings: string[];
}

@Injectable()
export class AgentQaLayoutService {
  resolveDirectory(projectPath: string): string {
    return join(projectPath, '.agent-qa');
  }

  async ensureDirectory(projectPath: string): Promise<EnsureAgentQaDirectoryResult> {
    const dir = this.resolveDirectory(projectPath);
    const warnings: string[] = [];
    let created = false;

    try {
      await access(dir);
    } catch {
      try {
        await mkdir(dir, { recursive: true });
        created = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to create .agent-qa/ at ${dir}: ${message}`);
      }
    }

    return { dir, created, warnings };
  }
}
