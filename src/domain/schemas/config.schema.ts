import { z } from 'zod';
import { LocatorDescriptorSchema } from './action.schema.js';
import { DestructiveActionPolicySchema, PlanActionSchema, PlanConditionSchema, RuntimeModeSchema } from './execution-plan.schema.js';

const AuthSelectorSchema = z.union([z.string(), LocatorDescriptorSchema]);

const SuccessWhenSchema = z.object({
  urlContains: z.string().optional(),
  textVisible: z.string().optional(),
}).refine((s) => s.urlContains || s.textVisible, {
  message: 'successWhen requires urlContains or textVisible',
});

const ElementAvailabilityContainerSchema = z.object({
  semanticKey: z.string().min(1),
  openAction: PlanActionSchema,
  expectedState: PlanConditionSchema.optional(),
}).strict();

export const RunConfigSchema = z.object({
  baseUrl: z.string().url(),
  appDomains: z.array(z.string()).min(1),
  demand: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1)).optional(),
    scope: z.object({ routes: z.array(z.string()).optional(), features: z.array(z.string()).optional() }).optional(),
  }),
  browser: z.object({
    engine: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
    headed: z.boolean().default(false),
    viewport: z.object({ width: z.number(), height: z.number() }).default({ width: 1280, height: 720 }),
    locale: z.string().default('pt-BR'),
    timezone: z.string().default('America/Sao_Paulo'),
    slowMoMs: z.number().int().nonnegative().optional(),
  }).default({ engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' }),
  auth: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('storageState'), path: z.string() }),
    z.object({
      kind: z.literal('formLogin'),
      loginUrl: z.string(),
      usernameSelector: AuthSelectorSchema,
      passwordSelector: AuthSelectorSchema,
      submitSelector: AuthSelectorSchema,
      usernameEnv: z.string(),
      passwordEnv: z.string(),
      successUrlContains: z.string().optional(),
      successWhen: SuccessWhenSchema.optional(),
      errorTextSelector: z.string().optional(),
      maxRetries: z.number().int().nonnegative().default(1),
    }),
    z.object({
      kind: z.literal('ssoRedirect'),
      loginUrl: z.string().optional(),
      loginButtonSelector: AuthSelectorSchema,
      idpUsernameSelector: AuthSelectorSchema.optional(),
      idpPasswordSelector: AuthSelectorSchema.optional(),
      idpSubmitSelector: AuthSelectorSchema.optional(),
      usernameEnv: z.string().optional(),
      passwordEnv: z.string().optional(),
      successUrlContains: z.string().optional(),
      successWhen: SuccessWhenSchema.optional(),
      storageStatePath: z.string().optional(),
    }),
  ]).default({ kind: 'none' }),
  llm: z.object({
    provider: z.enum(['fake', 'groq', 'openai']).default('fake'),
    model: z.string().default('llama-3.1-8b-instant'),
    apiKeyEnv: z.string().default('GROQ_PROVIDER'),
    maxSchemaRetries: z.number().int().nonnegative().default(2),
    promptVersion: z.string().default('v1'),
    temperature: z.number().min(0).max(1).default(0),
    maxTokens: z.number().int().positive().default(2048),
    rateLimitRetries: z.number().int().nonnegative().default(3),
    rateLimitMaxWaitMs: z.number().int().positive().default(30000),
  }).default({ provider: 'fake', model: 'fake', apiKeyEnv: 'GROQ_PROVIDER', maxSchemaRetries: 2, promptVersion: 'v1', temperature: 0, maxTokens: 2048, rateLimitRetries: 3, rateLimitMaxWaitMs: 30000 }),
  timeouts: z.object({
    quiescenceMs: z.number().int().positive().default(3000),
    actionMs: z.number().int().positive().default(15000),
    navigationMs: z.number().int().positive().default(30000),
    scenarioMs: z.number().int().positive().default(180000),
    runMs: z.number().int().positive().default(1800000),
    navigationRetry: z.object({ maxAttempts: z.number().int().positive().max(5).default(1), backoffMs: z.number().int().nonnegative().max(10000).default(250) }).optional(),
  }).default({ quiescenceMs: 3000, actionMs: 15000, navigationMs: 30000, scenarioMs: 180000, runMs: 1800000 }),
  runtime: z.object({
    maxActionsPerTask: z.number().int().positive().default(3),
    mode: RuntimeModeSchema.default('HYBRID_GUARDED'),
    maxAttemptsPerStep: z.number().int().positive().default(2),
    maxReplansPerScenario: z.number().int().nonnegative().default(2),
    destructiveActionPolicy: DestructiveActionPolicySchema.default('BLOCK'),
    semanticKeys: z.record(z.string(), z.object({ description: z.string(), type: z.enum(['action', 'state', 'container']).default('state') })).default({}),
    semanticAliases: z.record(z.string(), z.array(z.string().min(1)).min(1)).default({}),
    elementAvailability: z.object({
      enabled: z.boolean().default(true),
      maxOpenAttempts: z.number().int().nonnegative().default(1),
      allowGlobalEscape: z.boolean().default(false),
      allowClickOutside: z.boolean().default(false),
      allowedContainers: z.array(ElementAvailabilityContainerSchema).default([]),
    }).default({ enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }),
    enforceSingleTab: z.boolean().default(false),
    tools: z.object({
      enabled: z.boolean().default(false),
    }).default({ enabled: false }),
    observation: z.object({
      includeScreenshot: z.boolean().default(false),
    }).optional(),
    planning: z.object({
      executionPlanStrategy: z.enum(['llm_with_factory_fallback', 'factory_first']).default('llm_with_factory_fallback'),
      allowEmergencyPlan: z.boolean().default(false).optional(),
    }).optional(),
  }).default({ maxActionsPerTask: 3, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, enforceSingleTab: false, tools: { enabled: false } }),
  recovery: z.object({
    maxAttemptsPerTask: z.number().int().positive().default(3),
    maxFallbacksPerStep: z.number().int().positive().default(1),
    maxEmergencyActionsPerScenario: z.number().int().positive().default(5),
  }).default({ maxAttemptsPerTask: 3, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 5 }),
  classifier: z.object({
    knownNoiseRegexes: z.array(z.string()).optional(),
    knownThirdPartyDomains: z.array(z.string()).optional(),
    knownTrackingDomains: z.array(z.string()).optional(),
    treatThirdPartyNetwork5xxAsBug: z.boolean().default(false),
  }).default({ treatThirdPartyNetwork5xxAsBug: false }),
  privacy: z.object({
    maskEmails: z.boolean().default(false),
    maskJwt: z.boolean().default(true),
    maskCookies: z.boolean().default(true),
    additionalRegexes: z.array(z.string()).optional(),
  }).default({ maskEmails: false, maskJwt: true, maskCookies: true }),
  allowedRoutes: z.array(z.string()).optional(),
  clickup: z
    .object({
      taskId: z.string().min(1).optional(),
      teamId: z.string().min(1).optional(),
      customIdPattern: z.string().min(1).optional(),
    })
    .optional(),
  output: z.object({
    runsDir: z.string().default('./qa-agent-runs'),
    keepVideoOnPass: z.boolean().default(false),
    keepScreenshotOnPass: z.boolean().default(false),
    keepTraceOnPass: z.boolean().default(false),
  }).default({ runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false }),
  scenarioSelection: z.object({
    maxScenarios: z.number().int().min(1).max(100).optional().default(5),
  }).optional().default({ maxScenarios: 5 }),
  pr: z.object({
    repository: z.string().min(1),
    pullNumber: z.number().int().positive(),
    token: z.string().optional(),
    commitSha: z.string().optional(),
    headRef: z.string().optional(),
    baseRef: z.string().optional(),
  }).optional(),
  reporting: z.object({
    manualMinutesPerScenario: z.number().int().positive().default(10),
  }).optional(),
  evidence: z.object({
    video: z.enum(['off', 'on', 'on-failure']).default('off'),
    trace: z.enum(['off', 'on', 'on-failure']).default('off'),
  }).optional().default({ video: 'off', trace: 'off' }),
  agentVersion: z.string().default('0.1.0'),
});

export type RunConfig = z.infer<typeof RunConfigSchema>;
export type SuccessWhen = z.infer<typeof SuccessWhenSchema>;
