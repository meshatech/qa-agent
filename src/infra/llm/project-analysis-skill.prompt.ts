/**
 * Project Analysis skill (doc section 5/6): teaches the LLM to map a project from its
 * source code (no browser probe) into the ProjectKnowledge JSON shape. Used on the first
 * PR for a repo+branch, or when stored knowledge is stale.
 */

export interface ProjectAnalysisContextInput {
  repo: string;
  branch: string;
  commitSha?: string;
  previewUrl?: string;
  demand?: { title: string; description: string; acceptanceCriteria?: string[] };
  changedFiles: string[];
  affectedRoutes: string[];
  /** README + package.json summary + directory tree + representative source samples. */
  codeSnapshot: string;
}

export const PROJECT_ANALYSIS_SYSTEM_PROMPT = `You are a senior QA engineer mapping a web application from its SOURCE CODE.
You DO NOT browse the running app — infer everything from the code, the PR diff and the demand.

Return ONLY a single JSON object (no markdown, no prose) with this shape:
{
  "auth": {
    "kind": "none" | "formLogin" | "ssoRedirect" | "storageState" | "unknown",
    "loginUrl": string?,            // e.g. "/login"
    "loginModule": string?,         // e.g. "src/modules/auth/"
    "selectors": { "username": string?, "password": string?, "submit": string?, "loginButton": string? }?,
    "successWhen": { "urlContains": string?, "textVisible": string? }?,
    "idp": string?                  // e.g. "WSO2", "Keycloak" when SSO
  },
  "modulesRequiringAuth": [ { "name": string, "route": string?, "requiresAuth": true, "description": string? } ],
  "allModules": [ { "name": string, "route": string?, "requiresAuth": boolean, "description": string? } ],
  "businessRules": string[],
  "mainFlows": string[],
  "externalDependencies": string[],
  "uiPatterns": string[],
  "testData": [ { "field": string, "value": string, "note": string? } ],
  "consoleNoisePatterns": string[], // known non-bug console/network noise (trackers, ads, SDKs)
  "performanceBaselines": [ { "page": string, "metric": string, "value": string, "note": string? } ],
  "notes": string[]
}

Rules:
- Choose auth.kind: "formLogin" if you find email/password inputs + submit; "ssoRedirect" if you find an
  SSO/identity-provider redirect or a single "login" button delegating to an external IdP; "none" if the app
  has no authentication; "unknown" only if truly inconclusive.
- Prefer stable selectors (name/aria-label/data-testid). Omit fields you cannot infer (do not invent values).
- Keep arrays focused and deduplicated. Be concise.`;

export function buildProjectAnalysisContext(input: ProjectAnalysisContextInput): string {
  const parts: string[] = [];
  parts.push(`# Repository: ${input.repo} (branch: ${input.branch}${input.commitSha ? `, commit: ${input.commitSha}` : ''})`);
  if (input.previewUrl) parts.push(`Preview URL: ${input.previewUrl}`);

  if (input.demand) {
    parts.push('\n## Demand');
    parts.push(`Title: ${input.demand.title}`);
    parts.push(`Description: ${input.demand.description}`);
    if (input.demand.acceptanceCriteria?.length) {
      parts.push('Acceptance criteria:');
      parts.push(...input.demand.acceptanceCriteria.map((c) => `- ${c}`));
    }
  }

  parts.push('\n## PR Diff');
  parts.push(`Changed files (${input.changedFiles.length}):`);
  parts.push(...input.changedFiles.slice(0, 80).map((f) => `- ${f}`));
  if (input.affectedRoutes.length) {
    parts.push('Affected routes:');
    parts.push(...input.affectedRoutes.map((r) => `- ${r}`));
  }

  parts.push('\n## Code Snapshot');
  parts.push(input.codeSnapshot);

  return parts.join('\n');
}
