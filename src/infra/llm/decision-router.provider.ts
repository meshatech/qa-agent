import { Inject, Injectable } from '@nestjs/common';
import type { DecisionInput, DecisionProviderPort, ReplanInput } from '../../application/ports/decision-provider.port.js';
import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { QaScenario } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionPlan, PlanPatch } from '../../domain/schemas/execution-plan.schema.js';
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

  stats() {
    return {
      calls: this.fake.stats().calls + this.groq.stats().calls + this.openai.stats().calls,
      wrappers: { groq: this.groq.stats().wrappers, openai: this.openai.stats().wrappers },
    };
  }
}
