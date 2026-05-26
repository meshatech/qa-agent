import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import type { DecisionInput, DecisionProviderPort, ReplanInput } from '../../application/ports/decision-provider.port.js';
import { QaActionEnvelopeSchema, type QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionPlan, PlanPatch } from '../../domain/schemas/execution-plan.schema.js';
import { DECISION_SYSTEM_PROMPT, EXECUTION_PLAN_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, REPLAN_SYSTEM_PROMPT, buildDecisionUserMessage, buildExecutionPlanUserMessage, buildPlanUserMessage, buildReplanUserMessage } from './prompt-builder.js';
import { LlmPlanPatchNormalizer } from './llm-output-normalizer.js';

@Injectable()
export class OpenAiLangChainDecisionProvider implements DecisionProviderPort {
  private calls = 0;
  private readonly wrappers: Array<{ kind: 'plan' | 'patch'; wrapper: string }> = [];

  constructor(@Inject(LlmPlanPatchNormalizer) private readonly normalizer: LlmPlanPatchNormalizer = new LlmPlanPatchNormalizer()) {}

  async plan(config: RunConfig): Promise<QaScenario[]> {
    const apiKey = process.env[config.llm.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing env ${config.llm.apiKeyEnv}`);
    this.calls++;
    const model = new ChatOpenAI({
      apiKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      modelKwargs: { response_format: { type: 'json_object' } },
    });
    const res = await model.invoke([
      ['system', PLAN_SYSTEM_PROMPT],
      ['user', buildPlanUserMessage(config)],
    ]);
    const raw = JSON.parse(this.extractContent(res.content)) as { scenarios?: PlanScenarioRaw[] };
    return this.normalizePlan(raw, config);
  }

  async buildPlan(config: RunConfig, scenarios: QaScenario[] = []): Promise<ExecutionPlan> {
    const apiKey = process.env[config.llm.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing env ${config.llm.apiKeyEnv}`);
    this.calls++;
    const model = this.model(config, apiKey);
    const res = await model.invoke([
      ['system', EXECUTION_PLAN_SYSTEM_PROMPT],
      ['user', buildExecutionPlanUserMessage(config, scenarios)],
    ]);
    const parsed = this.normalizer.parsePlan(this.extractContent(res.content));
    this.wrappers.push({ kind: 'plan', wrapper: parsed.wrapper });
    return parsed.value;
  }

  async replan(input: ReplanInput): Promise<PlanPatch> {
    const apiKey = process.env[input.config.llm.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing env ${input.config.llm.apiKeyEnv}`);
    this.calls++;
    const model = this.model(input.config, apiKey);
    const res = await model.invoke([
      ['system', REPLAN_SYSTEM_PROMPT],
      ['user', buildReplanUserMessage(input)],
    ]);
    const parsed = this.normalizer.parsePatch(this.extractContent(res.content));
    this.wrappers.push({ kind: 'patch', wrapper: parsed.wrapper });
    return parsed.value;
  }

  async decide(input: DecisionInput): Promise<QaActionEnvelope> {
    const apiKey = process.env[input.config.llm.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing env ${input.config.llm.apiKeyEnv}`);
    let last: unknown;
    for (let i = 0; i <= input.config.llm.maxSchemaRetries; i++) {
      try {
        this.calls++;
        const model = new ChatOpenAI({
          apiKey,
          model: input.config.llm.model,
          temperature: input.config.llm.temperature,
          maxTokens: input.config.llm.maxTokens,
          modelKwargs: { response_format: { type: 'json_object' } },
        });
        const res = await model.invoke([
          ['system', DECISION_SYSTEM_PROMPT],
          ['user', buildDecisionUserMessage(input.observation, input.runData, input.config)],
        ]);
        const parsed = JSON.parse(this.extractContent(res.content));
        parsed.observationId = input.observation.observationId;
        return QaActionEnvelopeSchema.parse(parsed);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  stats() {
    return { calls: this.calls, wrappers: this.wrappers.slice(-20), breakdown: { plan: 0, buildPlan: 0, replan: 0, decide: 0 } };
  }

  private extractContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : 'text' in (c as Record<string, unknown>) ? String((c as { text: unknown }).text) : '')).join('');
    return String(content);
  }

  private model(config: RunConfig, apiKey: string): ChatOpenAI {
    return new ChatOpenAI({
      apiKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      modelKwargs: { response_format: { type: 'json_object' } },
    });
  }

  private normalizePlan(raw: { scenarios?: PlanScenarioRaw[] }, config: RunConfig): QaScenario[] {
    const scenarios = raw.scenarios?.length ? raw.scenarios : [{ id: 'scenario-001', title: config.demand.title, tasks: [{ id: 'T001', title: config.demand.description, expected: config.demand.description }] }];
    return scenarios.map((s, si) => ({
      id: s.id ?? `scenario-${String(si + 1).padStart(3, '0')}`,
      title: s.title ?? config.demand.title,
      status: 'PLANNED',
      intent: s.intent ?? 'POSITIVE',
      tasks: (s.tasks?.length ? s.tasks : [{ title: config.demand.description, expected: config.demand.description }]).map((t, ti) => ({
        id: t.id ?? `T${String(ti + 1).padStart(3, '0')}`,
        title: t.title ?? config.demand.description,
        expected: t.expected ?? t.title ?? config.demand.description,
        status: 'PENDING',
        dependsOn: t.dependsOn,
        intent: t.intent ?? 'POSITIVE',
      } as QaTask)),
    }));
  }
}

interface PlanScenarioRaw {
  id?: string;
  title?: string;
  intent?: 'POSITIVE' | 'NEGATIVE' | 'EDGE' | 'EXPLORATORY';
  tasks?: Array<{ id?: string; title?: string; expected?: string; intent?: 'POSITIVE' | 'NEGATIVE' | 'EDGE' | 'EXPLORATORY'; dependsOn?: string[] }>;
}
