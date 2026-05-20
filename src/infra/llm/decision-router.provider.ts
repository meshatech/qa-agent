import { Inject, Injectable } from '@nestjs/common';
import type { DecisionInput, DecisionProviderPort } from '../../application/ports/decision-provider.port.js';
import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { QaScenario } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
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

  stats() {
    return { calls: this.fake.stats().calls + this.groq.stats().calls + this.openai.stats().calls };
  }
}
