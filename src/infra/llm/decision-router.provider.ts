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

  decide(input: DecisionInput): Promise<QaActionEnvelope> {
    if (input.config.llm.provider === 'groq') return this.groq.decide(input);
    if (input.config.llm.provider === 'openai') return this.openai.decide(input);
    return this.fake.decide(input);
  }

  plan(config: RunConfig): Promise<QaScenario[]> {
    if (config.llm.provider === 'groq') return this.groq.plan(config);
    if (config.llm.provider === 'openai') return this.openai.plan(config);
    return this.fake.plan(config);
  }

  buildPlan(config: RunConfig, scenarios?: QaScenario[]): Promise<ExecutionPlan> {
    if (config.llm.provider === 'groq') return this.groq.buildPlan(config, scenarios);
    if (config.llm.provider === 'openai') return this.openai.buildPlan(config, scenarios);
    return this.fake.buildPlan(config, scenarios);
  }

  replan(input: ReplanInput): Promise<PlanPatch> {
    if (input.config.llm.provider === 'groq') return this.groq.replan(input);
    if (input.config.llm.provider === 'openai') return this.openai.replan(input);
    return this.fake.replan(input);
  }

  classifyOutcome(config: RunConfig, task: QaTask): Promise<ExpectedOutcome> {
    if (config.llm.provider === 'groq') return this.groq.classifyOutcome(config, task);
    if (config.llm.provider === 'openai') return this.openai.classifyOutcome(config, task);
    return this.fake.classifyOutcome(config, task);
  }

  classifyOutcomes(config: RunConfig, tasks: QaTask[]): Promise<ExpectedOutcome[]> {
    if (config.llm.provider === 'groq') return this.groq.classifyOutcomes(config, tasks);
    if (config.llm.provider === 'openai') return this.openai.classifyOutcomes(config, tasks);
    return this.fake.classifyOutcomes(config, tasks);
  }

  orchestrator(input: import('../../application/ports/decision-provider.port.js').OrchestratorInput): Promise<string> {
    if (input.config.llm.provider === 'groq') return this.groq.orchestrator!(input);
    if (input.config.llm.provider === 'openai') return this.openai.orchestrator!(input);
    return this.fake.orchestrator!(input);
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
