import { Inject, Injectable } from '@nestjs/common';
import type { DecisionInput, DecisionProviderPort, ReplanInput } from '../../application/ports/decision-provider.port.js';
import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { QaScenario } from '../../domain/models/run.model.js';
import type { QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionPlan, PlanPatch } from '../../domain/schemas/execution-plan.schema.js';
import type { ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';
import { FakeDecisionProvider } from './fake-decision.provider.js';
import { GroqDecisionProvider } from './groq-decision.provider.js';
import { OpenAiLangChainDecisionProvider } from './openai-langchain-decision.provider.js';

@Injectable()
export class DecisionRouterProvider implements DecisionProviderPort {
  constructor(
    @Inject(FakeDecisionProvider) private readonly fake: FakeDecisionProvider,
    @Inject(GroqDecisionProvider) private readonly groq: GroqDecisionProvider,
    @Inject(OpenAiLangChainDecisionProvider) private readonly openai: OpenAiLangChainDecisionProvider,
  ) {}

  private select(provider: RunConfig['llm']['provider']): DecisionProviderPort {
    if (provider === 'groq') return this.groq;
    if (provider === 'openai' || provider === 'openrouter' || provider === 'claude') return this.openai;
    return this.fake;
  }

  decide(input: DecisionInput): Promise<QaActionEnvelope> {
    return this.select(input.config.llm.provider).decide(input);
  }

  plan(config: RunConfig): Promise<QaScenario[]> {
    return this.select(config.llm.provider).plan!(config);
  }

  buildPlan(config: RunConfig, scenarios?: QaScenario[]): Promise<ExecutionPlan> {
    return this.select(config.llm.provider).buildPlan!(config, scenarios);
  }

  replan(input: ReplanInput): Promise<PlanPatch> {
    return this.select(input.config.llm.provider).replan!(input);
  }

  classifyOutcome(config: RunConfig, task: QaTask): Promise<ExpectedOutcome> {
    return this.select(config.llm.provider).classifyOutcome!(config, task);
  }

  classifyOutcomes(config: RunConfig, tasks: QaTask[]): Promise<ExpectedOutcome[]> {
    return this.select(config.llm.provider).classifyOutcomes!(config, tasks);
  }

  orchestrator(input: import('../../application/ports/decision-provider.port.js').OrchestratorInput): Promise<string> {
    return this.select(input.config.llm.provider).orchestrator!(input);
  }

  stats() {
    const fakeStats = this.fake.stats();
    const groqStats = this.groq.stats();
    const openaiStats = this.openai.stats();
    return {
      calls: (fakeStats.calls ?? 0) + (groqStats.calls ?? 0) + (openaiStats.calls ?? 0),
      wrappers: { groq: groqStats.wrappers, openai: openaiStats.wrappers },
      breakdown: {
        fake: fakeStats.breakdown ?? this.emptyBreakdown(),
        groq: groqStats.breakdown ?? this.emptyBreakdown(),
        openai: openaiStats.breakdown ?? this.emptyBreakdown(),
      },
    };
  }

  private emptyBreakdown() {
    return { plan: 0, classifyOutcome: 0, buildPlan: 0, replan: 0, decide: 0 };
  }
}
