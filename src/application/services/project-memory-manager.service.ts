import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  ProjectMemoryKey,
  ProjectMemoryStorePort,
} from '../ports/project-memory-store.port.js';
import {
  isProjectKnowledgeStale,
  type ProjectKnowledge,
} from '../../domain/schemas/project-knowledge.schema.js';
import type { ProjectAnalysisInputDto } from '../dto/project-analysis-input.dto.js';
import type { ResolveKnowledgeResultDto } from '../dto/resolve-knowledge-result.dto.js';
import { ProjectAnalysisService } from './project-analysis.service.js';

/**
 * Orchestrates the long-term project memory (doc section 6.3):
 * - First PR or stale (>30d) → run a full analysis and persist.
 * - Subsequent PRs → reuse stored knowledge; when re-analyzing, merge incrementally
 *   so prior knowledge is not lost.
 */
@Injectable()
export class ProjectMemoryManagerService {
  private readonly logger = new Logger(ProjectMemoryManagerService.name);

  constructor(
    @Inject('ProjectMemoryStorePort') private readonly store: ProjectMemoryStorePort,
    @Inject(ProjectAnalysisService) private readonly analysis: ProjectAnalysisService,
  ) {}

  load(key: ProjectMemoryKey): Promise<ProjectKnowledge | null> {
    return this.store.load(key);
  }

  async resolve(input: ProjectAnalysisInputDto): Promise<ResolveKnowledgeResultDto> {
    const key: ProjectMemoryKey = { repo: input.repo, branch: input.branch };

    let existing: ProjectKnowledge | null = null;
    try {
      existing = await this.store.load(key);
    } catch (error) {
      this.logger.warn(`Failed to load project memory: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (existing && !isProjectKnowledgeStale(existing)) {
      return { knowledge: existing, fromMemory: true, analyzed: false };
    }

    const fresh = await this.analysis.analyze(input);
    const merged = existing ? mergeKnowledge(existing, fresh) : fresh;

    try {
      await this.store.save(merged);
    } catch (error) {
      this.logger.warn(`Failed to persist project memory: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { knowledge: merged, fromMemory: false, analyzed: true };
  }
}

/** Incremental merge: fresh metadata/auth win; array knowledge is unioned to avoid regressions. */
export function mergeKnowledge(existing: ProjectKnowledge, fresh: ProjectKnowledge): ProjectKnowledge {
  return {
    schemaVersion: fresh.schemaVersion,
    metadata: fresh.metadata,
    auth: fresh.auth.kind === 'unknown' ? existing.auth : fresh.auth,
    modulesRequiringAuth: unionByJson(existing.modulesRequiringAuth, fresh.modulesRequiringAuth),
    allModules: unionByJson(existing.allModules, fresh.allModules),
    businessRules: unionStrings(existing.businessRules, fresh.businessRules),
    mainFlows: unionStrings(existing.mainFlows, fresh.mainFlows),
    externalDependencies: unionStrings(existing.externalDependencies, fresh.externalDependencies),
    uiPatterns: unionStrings(existing.uiPatterns, fresh.uiPatterns),
    testData: unionByJson(existing.testData, fresh.testData),
    consoleNoisePatterns: unionStrings(existing.consoleNoisePatterns, fresh.consoleNoisePatterns),
    knownTrackingDomains: unionStrings(existing.knownTrackingDomains, fresh.knownTrackingDomains),
    performanceBaselines: unionByJson(existing.performanceBaselines, fresh.performanceBaselines),
    notes: unionStrings(existing.notes, fresh.notes),
  };
}

function unionStrings(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

function unionByJson<T>(a: T[], b: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...a, ...b]) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
