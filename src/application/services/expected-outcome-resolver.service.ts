import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import type { ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';
import type { QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

/**
 * Resolves the typed ExpectedOutcome for a task.
 *
 * Resolution order (híbrida):
 * 1. Task already carries expectedOutcome → return as-is.
 * 2. No contract + LLM available → ask the LLM to translate title/expected
 *    into a valid ExpectedOutcome (validated by schema).
 * 3. No contract + LLM unavailable/fails → return NO_REGRESSION.
 *
 * No word/regex matching is ever used.
 */
@Injectable()
export class ExpectedOutcomeResolverService {
  private readonly logger = new Logger(ExpectedOutcomeResolverService.name);

  constructor(
    @Inject('DecisionProviderPort') private readonly provider: DecisionProviderPort,
  ) {}

  async resolve(config: RunConfig, task: QaTask): Promise<ExpectedOutcome> {
    if (task.expectedOutcome) {
      return task.expectedOutcome;
    }
    if (!this.provider.classifyOutcome) {
      return this.defaultOutcome(task);
    }
    try {
      return await this.provider.classifyOutcome(config, task);
    } catch (error) {
      this.logger.warn(`Expected outcome classification failed for task "${task.id}": ${this.errorMessage(error)}`);
      return {
        kind: 'CLASSIFICATION_FAILED',
        description: task.title,
      };
    }
  }

  async resolveMany(config: RunConfig, tasks: QaTask[]): Promise<ExpectedOutcome[]> {
    const unresolved = tasks.filter((task) => !task.expectedOutcome);
    if (!unresolved.length) return tasks.map((task) => task.expectedOutcome!);
    if (this.provider.classifyOutcomes) {
      try {
        const resolved = await this.provider.classifyOutcomes(config, unresolved);
        if (resolved.length !== unresolved.length) {
          this.logger.warn(`classifyOutcomes returned ${resolved.length} results for ${unresolved.length} tasks; using defaults for missing`);
        }
        const byTask = new Map<QaTask, ExpectedOutcome>();
        unresolved.forEach((task, index) => byTask.set(task, resolved[index] ?? this.defaultOutcome(task)));
        return tasks.map((task) => task.expectedOutcome ?? byTask.get(task) ?? this.defaultOutcome(task));
      } catch {
        // fall through to individual resolution/fallback
      }
    }
    const results: ExpectedOutcome[] = [];
    for (const task of tasks) {
      if (results.length > 0) {
        await this.sleep(100);
      }
      results.push(await this.resolve(config, task));
    }
    return results;
  }

  private defaultOutcome(task: QaTask): ExpectedOutcome {
    return {
      kind: 'NO_REGRESSION',
      description: task.title,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
