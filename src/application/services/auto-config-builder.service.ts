import { Inject, Injectable, Logger } from '@nestjs/common';

import type { LlmProviderPort } from '../ports/llm-provider.port.js';
import { SafeJsonParser } from '../../infra/llm/llm-output-normalizer.js';
import {
  AUTO_CONFIG_SYSTEM_PROMPT,
  buildAutoConfigContext,
  type AutoConfigEnrichment,
} from '../../infra/llm/auto-config-skill.prompt.js';
import { ProjectMemoryManagerService } from './project-memory-manager.service.js';
import { applyBaseUrlOverride } from '../helpers/apply-base-url-override.js';
import { resolveLlmFromEnv } from '../helpers/resolve-llm-from-env.helper.js';
import { safeHostname } from '../helpers/safe-hostname.helper.js';
import { diffTouchesProtected } from '../helpers/diff-touches-protected.helper.js';
import { RunConfigSchema, type RunConfig } from '../../domain/schemas/config.schema.js';
import type { ProjectKnowledge } from '../../domain/schemas/project-knowledge.schema.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';
import type { AutoConfigBuildInput, AutoConfigBuildOutput } from '../dto/auto-config-build.dto.js';

/**
 * Builds a RunConfig with no manual config file (doc section 4/7.3). Safety-critical fields
 * (baseUrl, appDomains, demand, auth, llm, pr) are computed deterministically; the LLM skill
 * only enriches optional scope/classifier fields and is never trusted for the rest.
 */
@Injectable()
export class AutoConfigBuilderService {
  private readonly logger = new Logger(AutoConfigBuilderService.name);

  constructor(
    @Inject(ProjectMemoryManagerService) private readonly memory: ProjectMemoryManagerService,
    @Inject('LlmProviderPort') private readonly llm: LlmProviderPort,
    @Inject(SafeJsonParser) private readonly jsonParser: SafeJsonParser,
  ) {}

  async build(input: AutoConfigBuildInput): Promise<AutoConfigBuildOutput> {
    const env = input.env ?? process.env;
    const warnings: string[] = [];

    const repo = (input.repo ?? env.GITHUB_REPOSITORY ?? 'local/project').trim();
    const branch = input.prDiff.pullRequest.baseBranch;
    const projectKey = { repo, branch };

    const domain = safeHostname(input.previewUrl);
    if (!domain) warnings.push(`Could not extract domain from preview URL: ${input.previewUrl}`);

    const resolved = await this.memory.resolve({
      repo,
      branch,
      commitSha: env.GITHUB_SHA?.trim() || undefined,
      previewUrl: input.previewUrl,
      projectPath: input.projectPath,
      changedFiles: input.prDiff.changedFiles.map((f) => f.path),
      affectedRoutes: input.prDiff.affectedRoutes,
      demand: {
        title: input.demand.title,
        description: input.demand.description,
        acceptanceCriteria: input.demand.acceptanceCriteria,
      },
      llmModel: resolveLlmFromEnv(env).model,
    });
    const knowledge = resolved.knowledge;

    const auth = this.computeAuth(knowledge, input.prDiff, env, warnings);
    const llm = resolveLlmFromEnv(env);

    const acceptanceCriteria = (input.demand.acceptanceCriteria ?? []).filter((c) => c.trim().length > 0);

    const configObject: Record<string, unknown> = {
      baseUrl: input.previewUrl,
      appDomains: domain ? [domain] : [input.previewUrl],
      demand: {
        id: input.demand.taskId,
        title: input.demand.title,
        description: input.demand.description.trim() || input.demand.title,
        ...(acceptanceCriteria.length ? { acceptanceCriteria } : {}),
      },
      auth,
      llm,
      pr: {
        repository: repo,
        pullNumber: input.prDiff.pullRequest.prNumber,
        ...(env.GITHUB_SHA?.trim() ? { commitSha: env.GITHUB_SHA.trim() } : {}),
        headRef: input.prDiff.pullRequest.headBranch,
        baseRef: branch,
      },
      classifier: {
        knownNoiseRegexes: knowledge.consoleNoisePatterns.length ? [...knowledge.consoleNoisePatterns] : undefined,
        treatThirdPartyNetwork5xxAsBug: false,
      },
      agentVersion: '0.1.0',
    };

    await this.applyEnrichment(configObject, input, knowledge, llm.model, warnings);

    let config: RunConfig;
    try {
      config = applyBaseUrlOverride(RunConfigSchema.parse(configObject), env);
    } catch (error) {
      throw new Error(`Generated config failed RunConfig validation: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      config,
      projectKey,
      knowledgeFromMemory: resolved.fromMemory,
      knowledgeAnalyzed: resolved.analyzed,
      warnings,
    };
  }

  /** Deterministic auth decision (doc section 5.3) + storageState precedence. */
  private computeAuth(
    knowledge: ProjectKnowledge,
    prDiff: PrDiffContext,
    env: NodeJS.ProcessEnv,
    warnings: string[],
  ): Record<string, unknown> {
    const storageState = env.QA_AGENT_STORAGE_STATE?.trim();
    if (storageState) {
      return { kind: 'storageState', path: storageState };
    }

    const kind = knowledge.auth.kind;
    if (kind !== 'formLogin' && kind !== 'ssoRedirect') {
      return { kind: 'none' };
    }

    if (!diffTouchesProtected(prDiff, knowledge)) {
      return { kind: 'none' };
    }

    const selectors = knowledge.auth.selectors ?? {};
    if (kind === 'formLogin') {
      if (selectors.username && selectors.password && selectors.submit) {
        return {
          kind: 'formLogin',
          loginUrl: knowledge.auth.loginUrl ?? '/login',
          usernameSelector: selectors.username,
          passwordSelector: selectors.password,
          submitSelector: selectors.submit,
          usernameEnv: env.QA_USERNAME_ENV?.trim() || 'QA_USERNAME',
          passwordEnv: env.QA_PASSWORD_ENV?.trim() || 'QA_PASSWORD',
          ...(knowledge.auth.successWhen ? { successWhen: knowledge.auth.successWhen } : {}),
        };
      }
      warnings.push('formLogin detected but selectors incomplete; falling back to auth.kind=none.');
      return { kind: 'none' };
    }

    // ssoRedirect
    if (selectors.loginButton) {
      return {
        kind: 'ssoRedirect',
        ...(knowledge.auth.loginUrl ? { loginUrl: knowledge.auth.loginUrl } : {}),
        loginButtonSelector: selectors.loginButton,
        ...(knowledge.auth.successWhen ? { successWhen: knowledge.auth.successWhen } : {}),
      };
    }
    warnings.push('ssoRedirect detected but loginButton selector missing; falling back to auth.kind=none.');
    return { kind: 'none' };
  }

  private async applyEnrichment(
    configObject: Record<string, unknown>,
    input: AutoConfigBuildInput,
    knowledge: ProjectKnowledge,
    model: string,
    warnings: string[],
  ): Promise<void> {
    let enrichment: AutoConfigEnrichment | null = null;
    try {
      const result = await this.llm.complete({
        context: buildAutoConfigContext({
          previewUrl: input.previewUrl,
          appDomain: safeHostname(input.previewUrl) ?? input.previewUrl,
          demand: {
            id: input.demand.taskId,
            title: input.demand.title,
            description: input.demand.description,
            acceptanceCriteria: input.demand.acceptanceCriteria,
          },
          prDiff: {
            repo: configObject.pr && typeof configObject.pr === 'object' ? (configObject.pr as { repository?: string }).repository : undefined,
            prNumber: input.prDiff.pullRequest.prNumber,
            baseBranch: input.prDiff.pullRequest.baseBranch,
            headBranch: input.prDiff.pullRequest.headBranch,
            changedFiles: input.prDiff.changedFiles.map((f) => f.path),
            affectedRoutes: input.prDiff.affectedRoutes,
          },
          authKind: (configObject.auth as { kind: string }).kind,
          projectKnowledge: knowledge,
        }),
        model,
        systemPrompt: AUTO_CONFIG_SYSTEM_PROMPT,
        temperature: 0,
        maxTokens: 2048,
        phase: 'auto-config',
      });
      const parsed = this.jsonParser.parse(result.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        enrichment = parsed as AutoConfigEnrichment;
      }
    } catch (error) {
      this.logger.warn(`Auto-config enrichment skipped: ${error instanceof Error ? error.message : String(error)}`);
      warnings.push('Auto-config LLM enrichment unavailable; using deterministic defaults.');
      return;
    }

    if (!enrichment) return;

    const demand = configObject.demand as Record<string, unknown>;
    const scopeRoutes = sanitizeStrings(enrichment.demandScope?.routes);
    const scopeFeatures = sanitizeStrings(enrichment.demandScope?.features);
    if (scopeRoutes.length || scopeFeatures.length) {
      demand.scope = {
        ...(scopeRoutes.length ? { routes: scopeRoutes } : {}),
        ...(scopeFeatures.length ? { features: scopeFeatures } : {}),
      };
    }

    const allowedRoutes = sanitizeStrings(enrichment.allowedRoutes);
    if (allowedRoutes.length) configObject.allowedRoutes = allowedRoutes;

    const classifier = configObject.classifier as Record<string, unknown>;
    const noise = sanitizeStrings(enrichment.classifier?.knownNoiseRegexes);
    if (noise.length) {
      classifier.knownNoiseRegexes = Array.from(new Set([...(asStringArray(classifier.knownNoiseRegexes)), ...noise]));
    }
    const tracking = sanitizeStrings(enrichment.classifier?.knownTrackingDomains);
    if (tracking.length) classifier.knownTrackingDomains = tracking;
    const thirdParty = sanitizeStrings(enrichment.classifier?.knownThirdPartyDomains);
    if (thirdParty.length) classifier.knownThirdPartyDomains = thirdParty;

    if (typeof enrichment.maxScenarios === 'number' && Number.isFinite(enrichment.maxScenarios)) {
      const max = Math.min(20, Math.max(1, Math.round(enrichment.maxScenarios)));
      configObject.scenarioSelection = { maxScenarios: max };
    }
  }
}

function sanitizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
