import { Inject, Injectable } from '@nestjs/common';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionStep } from '../../domain/schemas/execution-plan.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { QaAction } from '../../domain/schemas/action.schema.js';
import type { AttemptRecord } from '../../domain/models/run.model.js';

export interface DeepThinkInput {
  config: RunConfig;
  step: ExecutionStep;
  observation: ScreenObservation;
  error: string;
  previousActions: Array<{ action: QaAction; result: string; reason?: string }>;
  attempts: AttemptRecord[];
}

export interface DeepThinkResult {
  thought: string;
  criticism: string;
  action: QaAction;
  confidence: number;
}

@Injectable()
export class DeepThinkService {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
  ) {}

  async think(input: DeepThinkInput): Promise<DeepThinkResult> {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║               🧠 DEEP THINK — EMERGENCY REASONING            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const compressed = this.compressContext(input);
    console.log(`> OBSERVE: ${compressed.url} | ${compressed.title}`);
    console.log(`> ERROR: ${compressed.error.slice(0, 120)}`);
    console.log(`> GOAL: ${input.step.description}`);
    console.log(`> INTERACTIVE: ${compressed.elements.map((e) => e.text).join(' | ')}`);
    console.log('');

    if (!this.decision.deepThink) {
      throw new Error('Decision provider does not support deepThink');
    }

    const envelope = await this.decision.deepThink({
      config: input.config,
      observation: input.observation,
      runData: {
        stepDescription: input.step.description,
        stepIntent: (input.step.action as { target?: { intent?: string } }).target?.intent ?? input.step.description,
        compressedContext: JSON.stringify(compressed),
        error: input.error,
        previousActions: JSON.stringify(input.previousActions.slice(-3)),
      },
    });

    const thought = (envelope as unknown as Record<string, unknown>).thought as string ?? envelope.thought_summary ?? ' reasoning unavailable';
    const criticism = (envelope as unknown as Record<string, unknown>).criticism as string ?? 'no self-criticism';

    console.log(`> REASONING: ${thought}`);
    console.log(`> CRITICISM: ${criticism}`);
    const targetId = 'targetElementId' in envelope.action ? envelope.action.targetElementId : undefined;
    console.log(`> DECISION: ${envelope.action.type}${targetId ? ` → ${targetId}` : ''} (confidence: ${envelope.confidence})`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    return {
      thought,
      criticism,
      action: envelope.action,
      confidence: envelope.confidence,
    };
  }

  private compressContext(input: DeepThinkInput): {
    url: string;
    title: string;
    error: string;
    goal: string;
    elements: Array<{ text: string; role?: string; bounds?: string }>;
  } {
    const obs = input.observation;
    const interactive = obs.elements
      .filter((e) => ['button', 'link', 'textbox', 'combobox', 'searchbox', 'menuitem'].includes(e.role.toLowerCase()))
      .slice(0, 8)
      .map((e) => ({
        role: e.role ?? undefined,
        text: (e.text ?? e.name ?? e.ariaLabel ?? e.title ?? 'no-text').slice(0, 40),
        bounds: e.bounds ? `${e.bounds.x},${e.bounds.y}` : undefined,
      }));

    return {
      url: obs.url,
      title: obs.title,
      error: input.error,
      goal: input.step.description,
      elements: interactive,
    };
  }
}
