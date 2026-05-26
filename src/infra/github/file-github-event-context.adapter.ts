import { readFile } from 'node:fs/promises';

import { Injectable } from '@nestjs/common';

import type { GitHubEventContextPort } from '../../application/ports/github-event-context.port.js';

@Injectable()
export class FileGitHubEventContextAdapter implements GitHubEventContextPort {
  async resolvePullNumber(): Promise<number | undefined> {
    const fromRef = process.env.GITHUB_REF?.trim().match(/^refs\/pull\/(\d+)\//);
    if (fromRef) return Number(fromRef[1]);

    const fromEnv = process.env.GITHUB_PR_NUMBER?.trim();
    if (fromEnv) {
      const parsed = Number(fromEnv);
      if (!Number.isNaN(parsed)) return parsed;
    }

    const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
    if (!eventPath) return undefined;

    try {
      const raw = await readFile(eventPath, 'utf8');
      const event = JSON.parse(raw) as { pull_request?: { number?: number }; number?: number };
      const num = event.pull_request?.number ?? event.number;
      return typeof num === 'number' ? num : undefined;
    } catch {
      return undefined;
    }
  }
}
