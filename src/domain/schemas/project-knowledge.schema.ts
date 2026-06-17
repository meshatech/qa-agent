import { z } from 'zod';

/**
 * Long-term project knowledge persisted per repo+branch (V3 auto-config, section 6).
 *
 * Built by the project-analysis skill from the repo source + PR diff (no browser probe),
 * consumed by the auto-config builder to infer auth and scope. Multi-tenant (same repo,
 * different environments) is NOT modelled yet — deferred (doc section 9 #3).
 */

export const PROJECT_KNOWLEDGE_SCHEMA_VERSION = 'project-knowledge.v1' as const;

export const ProjectKnowledgeConfidenceSchema = z.enum(['low', 'medium', 'high']);

const AuthSelectorsSchema = z
  .object({
    // formLogin selectors (app-hosted form)
    username: z.string().optional(),
    password: z.string().optional(),
    submit: z.string().optional(),
    // ssoRedirect: button that delegates to the external IdP
    loginButton: z.string().optional(),
    // ssoRedirect: selectors on the IdP login page (when the IdP form is automatable)
    idpUsername: z.string().optional(),
    idpPassword: z.string().optional(),
    idpSubmit: z.string().optional(),
  })
  .partial();

const SuccessWhenSchema = z
  .object({
    urlContains: z.string().optional(),
    textVisible: z.string().optional(),
  })
  .partial();

export const ProjectKnowledgeAuthSchema = z.object({
  /** Inferred auth kind for the application. `unknown` when analysis was inconclusive. */
  kind: z.enum(['none', 'formLogin', 'ssoRedirect', 'storageState', 'unknown']).default('unknown'),
  loginUrl: z.string().optional(),
  loginModule: z.string().optional(),
  selectors: AuthSelectorsSchema.optional(),
  successWhen: SuccessWhenSchema.optional(),
  /** External identity provider, when SSO (e.g. "WSO2", "Keycloak"). */
  idp: z.string().optional(),
  /** Path to a pre-captured storageState the SSO flow can reuse, when applicable. */
  storageStatePath: z.string().optional(),
});

const ModuleSchema = z.object({
  name: z.string().min(1),
  route: z.string().optional(),
  requiresAuth: z.boolean().default(false),
  description: z.string().optional(),
});

const PerformanceBaselineSchema = z.object({
  page: z.string().min(1),
  metric: z.string().min(1),
  value: z.string().min(1),
  note: z.string().optional(),
});

const TestDatumSchema = z.object({
  field: z.string().min(1),
  value: z.string().min(1),
  note: z.string().optional(),
});

export const ProjectKnowledgeMetadataSchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  analyzedAt: z.string().datetime(),
  commitSha: z.string().optional(),
  confidence: ProjectKnowledgeConfidenceSchema.default('low'),
});

export const ProjectKnowledgeSchema = z.object({
  schemaVersion: z.literal(PROJECT_KNOWLEDGE_SCHEMA_VERSION).default(PROJECT_KNOWLEDGE_SCHEMA_VERSION),
  metadata: ProjectKnowledgeMetadataSchema,
  auth: ProjectKnowledgeAuthSchema.default({ kind: 'unknown' }),
  /** Routes/features that require authentication (subset of `allModules`). */
  modulesRequiringAuth: z.array(ModuleSchema).default([]),
  /** Full application module map. */
  allModules: z.array(ModuleSchema).default([]),
  businessRules: z.array(z.string().min(1)).default([]),
  mainFlows: z.array(z.string().min(1)).default([]),
  externalDependencies: z.array(z.string().min(1)).default([]),
  uiPatterns: z.array(z.string().min(1)).default([]),
  testData: z.array(TestDatumSchema).default([]),
  /** Known non-bug console noise (trackers, ads, SDKs) as regex patterns. */
  consoleNoisePatterns: z.array(z.string().min(1)).default([]),
  /** Known third-party tracking/analytics domains to ignore in the bug classifier. */
  knownTrackingDomains: z.array(z.string().min(1)).default([]),
  performanceBaselines: z.array(PerformanceBaselineSchema).default([]),
  notes: z.array(z.string().min(1)).default([]),
});

export type ProjectKnowledge = z.infer<typeof ProjectKnowledgeSchema>;
export type ProjectKnowledgeAuth = z.infer<typeof ProjectKnowledgeAuthSchema>;
export type ProjectKnowledgeMetadata = z.infer<typeof ProjectKnowledgeMetadataSchema>;
export type ProjectKnowledgeConfidence = z.infer<typeof ProjectKnowledgeConfidenceSchema>;

export const PROJECT_KNOWLEDGE_STALE_DAYS = 30;

/** True when the knowledge was analyzed more than `days` ago (forces a fresh analysis). */
export function isProjectKnowledgeStale(
  knowledge: { metadata: { analyzedAt: string } },
  days: number = PROJECT_KNOWLEDGE_STALE_DAYS,
  now: Date = new Date(),
): boolean {
  const analyzedAt = Date.parse(knowledge.metadata.analyzedAt);
  if (Number.isNaN(analyzedAt)) return true;
  const ageMs = now.getTime() - analyzedAt;
  return ageMs > days * 24 * 60 * 60 * 1000;
}
