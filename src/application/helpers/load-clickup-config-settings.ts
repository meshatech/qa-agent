import { resolve } from 'node:path';

import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';

export interface ClickUpConfigSettings {
  taskId?: string;
  customIdPattern?: string;
}

export function resolveAgentQaConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const rawPath = env.AGENT_QA_CONFIG?.trim() || './agent-qa.config.json';
  const base = env.GITHUB_WORKSPACE?.trim() || process.cwd();
  return resolve(base, rawPath);
}

export async function loadClickUpConfigSettings(
  configLoader: ConfigLoaderPort,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClickUpConfigSettings> {
  try {
    const raw = await configLoader.load(resolveAgentQaConfigPath(env));
    const parsed = RunConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return {};
    }

    return {
      taskId: parsed.data.clickup?.taskId?.trim() || undefined,
      customIdPattern: parsed.data.clickup?.customIdPattern?.trim() || undefined,
    };
  } catch {
    return {};
  }
}
