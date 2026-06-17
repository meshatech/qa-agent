import type { ProjectKnowledge } from '../../domain/schemas/project-knowledge.schema.js';

/**
 * Auto-Config skill (doc section 4): teaches the LLM to enrich the optional/scope fields of
 * a RunConfig from the preview URL + demand + diff + project knowledge.
 *
 * Safety-critical fields (baseUrl, appDomains, demand, auth, llm, pr) are computed
 * deterministically by AutoConfigBuilderService and override whatever the LLM returns —
 * the LLM only contributes scope/classifier enrichment.
 */

export interface AutoConfigContextInput {
  previewUrl: string;
  appDomain: string;
  demand: { id: string; title: string; description: string; acceptanceCriteria?: string[] };
  prDiff: {
    repo?: string;
    prNumber: number;
    baseBranch: string;
    headBranch: string;
    changedFiles: string[];
    affectedRoutes: string[];
  };
  authKind: string;
  projectKnowledge?: ProjectKnowledge;
}

export const AUTO_CONFIG_SYSTEM_PROMPT = `You configure a QA automation run. You will be given a preview URL, a ClickUp demand,
a PR diff and prior project knowledge. Return ONLY a single JSON object (no markdown) that ENRICHES the
optional run-config fields below. Do NOT set baseUrl/appDomains/auth/llm/pr — those are fixed by the harness.

Return this shape (omit a field when you have nothing meaningful to add):
{
  "demandScope": { "routes": string[]?, "features": string[]? },   // what to focus testing on
  "allowedRoutes": string[]?,                                       // absolute or relative routes safe to visit
  "classifier": {
    "knownNoiseRegexes": string[]?,        // console messages to ignore (regex)
    "knownTrackingDomains": string[]?,     // analytics/ads domains to ignore
    "knownThirdPartyDomains": string[]?
  },
  "maxScenarios": number?                   // 1..20, focus on the diff
}

Rules:
- Derive scope/routes from the demand + affected routes in the diff. Be conservative.
- Reuse the project's known console-noise patterns. Do not invent domains.
- Keep it concise and strictly valid JSON.`;

export function buildAutoConfigContext(input: AutoConfigContextInput): string {
  const parts: string[] = [];
  parts.push(`# Preview: ${input.previewUrl} (domain: ${input.appDomain})`);
  parts.push(`Auth kind (fixed by harness): ${input.authKind}`);

  parts.push('\n## Demand');
  parts.push(`[${input.demand.id}] ${input.demand.title}`);
  parts.push(input.demand.description);
  if (input.demand.acceptanceCriteria?.length) {
    parts.push('Acceptance criteria:');
    parts.push(...input.demand.acceptanceCriteria.map((c) => `- ${c}`));
  }

  parts.push('\n## PR Diff');
  parts.push(`PR #${input.prDiff.prNumber} (${input.prDiff.headBranch} → ${input.prDiff.baseBranch})`);
  parts.push(`Changed files (${input.prDiff.changedFiles.length}):`);
  parts.push(...input.prDiff.changedFiles.slice(0, 60).map((f) => `- ${f}`));
  if (input.prDiff.affectedRoutes.length) {
    parts.push('Affected routes:');
    parts.push(...input.prDiff.affectedRoutes.map((r) => `- ${r}`));
  }

  if (input.projectKnowledge) {
    const k = input.projectKnowledge;
    parts.push('\n## Project Knowledge');
    if (k.allModules.length) {
      parts.push('Modules:');
      parts.push(...k.allModules.map((m) => `- ${m.name}${m.route ? ` (${m.route})` : ''}${m.requiresAuth ? ' [auth]' : ''}`));
    }
    if (k.consoleNoisePatterns.length) {
      parts.push('Known console noise:');
      parts.push(...k.consoleNoisePatterns.map((n) => `- ${n}`));
    }
  }

  return parts.join('\n');
}

/** Schema of the LLM enrichment output (parsed defensively; never trusted for safety-critical fields). */
export interface AutoConfigEnrichment {
  demandScope?: { routes?: string[]; features?: string[] };
  allowedRoutes?: string[];
  classifier?: {
    knownNoiseRegexes?: string[];
    knownTrackingDomains?: string[];
    knownThirdPartyDomains?: string[];
  };
  maxScenarios?: number;
}
