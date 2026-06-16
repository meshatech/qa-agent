import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { DecisionInput, DecisionProviderPort, ReplanInput } from '../../application/ports/decision-provider.port.js';
import { QaActionEnvelopeSchema, type QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionPlan, PlanPatch } from '../../domain/schemas/execution-plan.schema.js';
import { ExpectedOutcomeSchema, type ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';
import { CLASSIFY_OUTCOME_SYSTEM_PROMPT, DECISION_SYSTEM_PROMPT, EXECUTION_PLAN_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, REPLAN_SYSTEM_PROMPT, buildClassifyOutcomeUserMessage, buildClassifyOutcomesUserMessage, buildDecisionUserMessage, buildExecutionPlanUserMessage, buildPlanUserMessage, buildReplanUserMessage } from './prompt-builder.js';
import { LlmPlanPatchNormalizer } from './llm-output-normalizer.js';

interface LangChainUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

@Injectable()
export class OpenAiLangChainDecisionProvider implements DecisionProviderPort {
  private calls = 0;
  private readonly callCounts = { plan: 0, classifyOutcome: 0, buildPlan: 0, replan: 0, decide: 0 };
  private tokensIn = 0;
  private tokensOut = 0;
  private readonly wrappers: Array<{ kind: 'plan' | 'patch'; wrapper: string }> = [];

  constructor(@Inject(LlmPlanPatchNormalizer) private readonly normalizer: LlmPlanPatchNormalizer = new LlmPlanPatchNormalizer()) {}

  async plan(config: RunConfig): Promise<QaScenario[]> {
    this.calls++;
    this.callCounts.plan++;
    const model = this.model(config);
    const res = await model.invoke([
      ['system', PLAN_SYSTEM_PROMPT],
      ['user', buildPlanUserMessage(config)],
    ]);
    this.accumulateUsage(res);
    const raw = JSON.parse(this.extractContent(res.content)) as { scenarios?: PlanScenarioRaw[] };
    return this.normalizePlan(raw, config);
  }

  async buildPlan(config: RunConfig, scenarios: QaScenario[] = []): Promise<ExecutionPlan> {
    this.calls++;
    this.callCounts.buildPlan++;
    const model = this.model(config);
    const res = await model.invoke([
      ['system', EXECUTION_PLAN_SYSTEM_PROMPT],
      ['user', buildExecutionPlanUserMessage(config, scenarios)],
    ]);
    this.accumulateUsage(res);
    const parsed = this.normalizer.parsePlan(this.extractContent(res.content));
    this.wrappers.push({ kind: 'plan', wrapper: parsed.wrapper });
    return parsed.value;
  }

  async replan(input: ReplanInput): Promise<PlanPatch> {
    this.calls++;
    this.callCounts.replan++;
    const model = this.model(input.config);
    const res = await model.invoke([
      ['system', REPLAN_SYSTEM_PROMPT],
      ['user', buildReplanUserMessage(input)],
    ]);
    this.accumulateUsage(res);
    const parsed = this.normalizer.parsePatch(this.extractContent(res.content));
    this.wrappers.push({ kind: 'patch', wrapper: parsed.wrapper });
    return parsed.value;
  }

  async decide(input: DecisionInput): Promise<QaActionEnvelope> {
    let last: unknown;
    for (let i = 0; i <= input.config.llm.maxSchemaRetries; i++) {
      try {
        this.calls++;
        this.callCounts.decide++;
        const model = this.model(input.config);
        const res = await model.invoke([
          ['system', DECISION_SYSTEM_PROMPT],
          ['user', buildDecisionUserMessage(input.observation, input.runData, input.config)],
        ]);
        this.accumulateUsage(res);
        const parsed = JSON.parse(this.extractContent(res.content));
        parsed.observationId = input.observation.observationId;
        return QaActionEnvelopeSchema.parse(parsed);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  async classifyOutcome(config: RunConfig, task: QaTask): Promise<ExpectedOutcome> {
    this.callCounts.classifyOutcome++;
    const model = this.model(config);
    const res = await model.invoke([
      ['system', CLASSIFY_OUTCOME_SYSTEM_PROMPT],
      ['user', buildClassifyOutcomeUserMessage(task.title, task.expected)],
    ]);
    this.accumulateUsage(res);
    const raw = JSON.parse(this.extractContent(res.content));
    return this.parseOutcome(raw, task);
  }

  async classifyOutcomes(config: RunConfig, tasks: QaTask[]): Promise<ExpectedOutcome[]> {
    this.callCounts.classifyOutcome++;
    const model = this.model(config);
    const res = await model.invoke([
      ['system', CLASSIFY_OUTCOME_SYSTEM_PROMPT],
      ['user', buildClassifyOutcomesUserMessage(tasks.map((task) => ({ id: task.id, title: task.title, expected: task.expected })))],
    ]);
    this.accumulateUsage(res);
    const raw = JSON.parse(this.extractContent(res.content));
    const items = this.extractOutcomeItems(raw);
    if (items.length !== tasks.length) throw new Error('Invalid outcome batch size from LLM');
    return items.map((item, index) => this.parseOutcome(item, tasks[index]!));
  }

  async orchestrator(input: import('../../application/ports/decision-provider.port.js').OrchestratorInput): Promise<string> {
    this.calls++;
    const model = this.model(input.config);
    const res = await model.invoke([
      ['system', input.systemPrompt],
      ['user', input.userMessage],
    ]);
    this.accumulateUsage(res);
    return this.extractContent(res.content);
  }

  stats() {
    return { calls: this.calls, tokensIn: this.tokensIn, tokensOut: this.tokensOut, wrappers: this.wrappers.slice(-20), breakdown: { ...this.callCounts } };
  }

  private extractUsage(res: unknown): LangChainUsage | undefined {
    if (!res || typeof res !== 'object') return undefined;
    const record = res as Record<string, unknown>;
    const usage = record.usage_metadata as LangChainUsage | undefined;
    if (usage) return usage;
    const responseMeta = record.response_metadata as Record<string, unknown> | undefined;
    const tokenUsage = responseMeta?.tokenUsage as LangChainUsage | undefined;
    return tokenUsage;
  }

  private accumulateUsage(res: unknown): void {
    const usage = this.extractUsage(res);
    if (usage) {
      this.tokensIn += usage.input_tokens ?? 0;
      this.tokensOut += usage.output_tokens ?? 0;
    }
  }

  private extractContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : 'text' in (c as Record<string, unknown>) ? String((c as { text: unknown }).text) : '')).join('');
    return String(content);
  }

  private model(config: RunConfig): BaseChatModel {
    const apiKey = process.env[config.llm.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing env ${config.llm.apiKeyEnv}`);
    if (config.llm.provider === 'claude') {
      return new ChatAnthropic({
        apiKey,
        model: config.llm.model,
        temperature: config.llm.temperature,
        maxTokens: config.llm.maxTokens,
      });
    }
    const baseURL = this.resolveBaseUrl(config.llm.provider);
    return new ChatOpenAI({
      apiKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      modelKwargs: { response_format: { type: 'json_object' } },
      ...(baseURL ? { configuration: { baseURL } } : {}),
    });
  }

  private resolveBaseUrl(provider: RunConfig['llm']['provider']): string | undefined {
    if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
    return undefined;
  }

  private parseOutcome(raw: unknown, task: QaTask): ExpectedOutcome {
    const kind = this.extractOutcomeKind(raw);
    if (!kind) throw new Error('Invalid outcome kind from LLM');
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const target = typeof record.target === 'string' && record.target && record.target !== 'NO_REGRESSION' ? record.target : undefined;
    return ExpectedOutcomeSchema.parse({
      kind,
      target,
      description: typeof record.description === 'string' && record.description ? record.description : task.title,
    });
  }

  private extractOutcomeKind(raw: unknown): ExpectedOutcome['kind'] | undefined {
    const kind = typeof raw === 'object' && raw && typeof (raw as Record<string, unknown>).kind === 'string' ? (raw as Record<string, unknown>).kind : undefined;
    if (!kind) return undefined;
    const validKinds: ExpectedOutcome['kind'][] = ['AUTHENTICATION', 'DEAUTHENTICATION', 'NAVIGATION', 'APPEARANCE_CHANGE', 'DISCLOSURE', 'CONTENT_PRESENCE', 'DATA_ENTRY', 'NO_REGRESSION', 'CLASSIFICATION_FAILED'];
    return validKinds.find((k) => k.toLowerCase() === (kind as string).toLowerCase().trim());
  }

  private extractOutcomeItems(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const record = raw as Record<string, unknown>;
      if (Array.isArray(record.outcomes)) return record.outcomes;
      if (Array.isArray(record.results)) return record.results;
      if (Array.isArray(record.tasks)) return record.tasks;
    }
    return [];
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
        expectedOutcome: this.parseExpectedOutcome(t.expectedOutcome),
      } as QaTask)),
    }));
  }

  private parseExpectedOutcome(value: unknown): ExpectedOutcome | undefined {
    const parsed = ExpectedOutcomeSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }
}

interface PlanScenarioRaw {
  id?: string;
  title?: string;
  intent?: 'POSITIVE' | 'NEGATIVE' | 'EDGE' | 'EXPLORATORY';
  tasks?: Array<{ id?: string; title?: string; expected?: string; intent?: 'POSITIVE' | 'NEGATIVE' | 'EDGE' | 'EXPLORATORY'; dependsOn?: string[]; expectedOutcome?: unknown }>;
}
