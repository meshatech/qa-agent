import type { RunConfig } from '../../domain/schemas/config.schema.js';

export function applyBaseUrlOverride(config: RunConfig, env: NodeJS.ProcessEnv = process.env): RunConfig {
  const overrideUrl = env.QA_AGENT_BASE_URL?.trim();
  const previewDomain = env.QA_AGENT_PREVIEW_DOMAIN?.trim().replace(/^\*\./, '');
  if (!overrideUrl && !previewDomain) return config;

  const baseUrl = overrideUrl || config.baseUrl;
  const domains = new Set(config.appDomains);
  if (previewDomain) {
    domains.add(previewDomain);
  } else if (overrideUrl) {
    try {
      domains.add(new URL(overrideUrl).hostname);
    } catch {
      // ignore invalid override URL for domain extraction
    }
  }

  return { ...config, baseUrl, appDomains: [...domains] };
}
