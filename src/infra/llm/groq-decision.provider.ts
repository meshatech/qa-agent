import { Inject, Injectable } from '@nestjs/common';
import { request as httpsRequest } from 'node:https';
import type { DecisionInput, DecisionProviderPort, ReplanInput } from '../../application/ports/decision-provider.port.js';
import { QaActionEnvelopeSchema, type ExpectedAfterAction, type QaAction, type QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionPlan, PlanPatch } from '../../domain/schemas/execution-plan.schema.js';
import { DECISION_SYSTEM_PROMPT, EXECUTION_PLAN_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, REPLAN_SYSTEM_PROMPT, buildDecisionUserMessage, buildExecutionPlanUserMessage, buildPlanUserMessage, buildReplanUserMessage } from './prompt-builder.js';
import { LlmPlanPatchNormalizer } from './llm-output-normalizer.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

@Injectable()
export class GroqDecisionProvider implements DecisionProviderPort {
  private calls = 0;
  private readonly callCounts = { plan: 0, buildPlan: 0, replan: 0, decide: 0 };
  private readonly wrappers: Array<{ kind: 'plan' | 'patch'; wrapper: string }> = [];

  constructor(@Inject(LlmPlanPatchNormalizer) private readonly normalizer: LlmPlanPatchNormalizer = new LlmPlanPatchNormalizer()) {}

  async plan(config: RunConfig): Promise<QaScenario[]> {
    this.callCounts.plan++;
    const key = process.env[config.llm.apiKeyEnv];
    if (!key) throw new Error(`Missing env ${config.llm.apiKeyEnv}`);
    const json = await this.chatJson(config, key, 'plan', {
      model: config.llm.model,
      temperature: config.llm.temperature,
      max_tokens: config.llm.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PLAN_SYSTEM_PROMPT },
        { role: 'user', content: buildPlanUserMessage(config) },
      ],
    });
    return this.normalizePlan(JSON.parse(json.choices[0]?.message.content ?? '{}'), config);
  }

  async buildPlan(config: RunConfig, scenarios: QaScenario[] = []): Promise<ExecutionPlan> {
    this.callCounts.buildPlan++;
    const key = process.env[config.llm.apiKeyEnv];
    if (!key) throw new Error(`Missing env ${config.llm.apiKeyEnv}`);
    const json = await this.chatJson(config, key, 'execution-plan', {
      model: config.llm.model,
      temperature: config.llm.temperature,
      max_tokens: config.llm.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXECUTION_PLAN_SYSTEM_PROMPT },
        { role: 'user', content: buildExecutionPlanUserMessage(config, scenarios) },
      ],
    });
    const parsed = this.normalizer.parsePlan(json.choices[0]?.message.content ?? '{}');
    this.wrappers.push({ kind: 'plan', wrapper: parsed.wrapper });
    return parsed.value;
  }

  async replan(input: ReplanInput): Promise<PlanPatch> {
    this.callCounts.replan++;
    const key = process.env[input.config.llm.apiKeyEnv];
    if (!key) throw new Error(`Missing env ${input.config.llm.apiKeyEnv}`);
    const json = await this.chatJson(input.config, key, 'replan', {
      model: input.config.llm.model,
      temperature: input.config.llm.temperature,
      max_tokens: input.config.llm.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: REPLAN_SYSTEM_PROMPT },
        { role: 'user', content: buildReplanUserMessage(input) },
      ],
    });
    const parsed = this.normalizer.parsePatch(json.choices[0]?.message.content ?? '{}');
    this.wrappers.push({ kind: 'patch', wrapper: parsed.wrapper });
    return parsed.value;
  }

  async decide(input: DecisionInput): Promise<QaActionEnvelope> {
    this.callCounts.decide++;
    const key = process.env[input.config.llm.apiKeyEnv];
    if (!key) throw new Error(`Missing env ${input.config.llm.apiKeyEnv}`);
    let lastError: unknown;
    for (let i = 0; i <= input.config.llm.maxSchemaRetries; i++) {
      try {
        const json = await this.chatJson(input.config, key, 'decision', {
          model: input.config.llm.model,
          temperature: input.config.llm.temperature,
          max_tokens: input.config.llm.maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: DECISION_SYSTEM_PROMPT },
            { role: 'user', content: buildDecisionUserMessage(input.observation, input.runData, input.config) },
          ],
        });
        const parsed = JSON.parse(json.choices[0]?.message.content ?? '{}');
        return this.parseDecision(parsed, input);
      } catch (error) {
        lastError = error;
      }
    }
    return this.abortEnvelope(input, lastError);
  }

  stats() {
    return { calls: this.calls, wrappers: this.wrappers.slice(-20), breakdown: { ...this.callCounts } };
  }

  private async chatJson(config: RunConfig, key: string, kind: 'plan' | 'decision' | 'execution-plan' | 'replan', body: unknown): Promise<GroqChatResponse> {
    let lastError = '';
    for (let attempt = 0; attempt <= config.llm.rateLimitRetries; attempt++) {
      this.calls++;
      const res = await this.fetchGroq(key, body, kind);
      if (res.ok) return (await res.json()) as GroqChatResponse;

      const text = await res.text().catch(() => '');
      lastError = `Groq ${kind} error ${res.status}: ${text}`;
      if (res.status !== 429 || attempt === config.llm.rateLimitRetries) throw new Error(lastError);
      await this.sleep(this.retryWaitMs(res.headers, text, attempt, config.llm.rateLimitMaxWaitMs));
    }
    throw new Error(lastError);
  }

  private async fetchGroq(key: string, body: unknown, kind: string): Promise<Response> {
    try {
      return await fetch(GROQ_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key.trim()}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (this.isTlsCertificateError(error) && process.env.AGENT_QA_ALLOW_INSECURE_LLM_TLS === 'true') {
        return this.insecureTlsFetch(key, body);
      }
      if (this.isTlsCertificateError(error)) {
        throw new Error(
          `Groq ${kind} TLS certificate verification failed. Configure NODE_EXTRA_CA_CERTS with the corporate/root CA certificate, or set AGENT_QA_ALLOW_INSECURE_LLM_TLS=true only in local/HML environments. Cause: ${this.errorCause(error)}`,
        );
      }
      throw error;
    }
  }

  private insecureTlsFetch(key: string, body: unknown): Promise<Response> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        GROQ_URL,
        {
          method: 'POST',
          rejectUnauthorized: false,
          headers: {
            authorization: `Bearer ${key.trim()}`,
            'content-type': 'application/json',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve(new Response(text, { status: res.statusCode ?? 500, statusText: res.statusMessage, headers: res.headers as HeadersInit }));
          });
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  private isTlsCertificateError(error: unknown): boolean {
    const cause = error && typeof error === 'object' ? (error as { cause?: { code?: string; message?: string } }).cause : undefined;
    const message = cause?.message ?? (error instanceof Error ? error.message : String(error));
    return cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || /certificate|unable to verify/i.test(message);
  }

  private errorCause(error: unknown): string {
    const cause = error && typeof error === 'object' ? (error as { cause?: { code?: string; message?: string } }).cause : undefined;
    return [cause?.code, cause?.message].filter(Boolean).join(' - ') || (error instanceof Error ? error.message : String(error));
  }

  private retryWaitMs(headers: Headers, body: string, attempt: number, maxWaitMs: number): number {
    const retryAfter = Number(headers.get('retry-after'));
    const bodySeconds = Number(body.match(/try again in ([\d.]+)s/i)?.[1]);
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Number.isFinite(bodySeconds) && bodySeconds > 0 ? bodySeconds : Math.min(2 ** attempt, 10);
    return Math.min(Math.ceil(seconds * 1000), maxWaitMs);
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseDecision(raw: unknown, input: DecisionInput): QaActionEnvelope {
    const candidate = this.repairEnvelope(raw, input);
    return QaActionEnvelopeSchema.parse(candidate);
  }

  private repairEnvelope(raw: unknown, input: DecisionInput): unknown {
    const obj = typeof raw === 'object' && raw ? { ...(raw as Record<string, unknown>) } : {};
    obj.schemaVersion = 'action.v1';
    obj.observationId = input.observation.observationId;
    obj.thought_summary = typeof obj.thought_summary === 'string' && obj.thought_summary.trim() ? obj.thought_summary : 'LLM response normalized to match action schema.';
    obj.confidence = typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.3;
    obj.action = this.repairAction(obj.action, input, 'normalized action contract');
    obj.fallback_action = this.repairAction(obj.fallback_action, input, 'close transient UI');
    obj.expected_after_action = this.repairExpected(obj.expected_after_action, input);
    return obj;
  }

  private repairAction(raw: unknown, input: DecisionInput, reason: string): QaAction {
    const action = typeof raw === 'object' && raw ? { ...(raw as Record<string, unknown>) } : {};
    const type = typeof action.type === 'string' ? action.type : 'waitForStable';
    action.reason = typeof action.reason === 'string' && action.reason.trim() ? action.reason : reason;

    if ('targetElementId' in action) {
      const normalized = this.normalizeElementId(action.targetElementId, input);
      if (normalized) action.targetElementId = normalized;
      else delete action.targetElementId;
    }
    if ((type === 'click' || type === 'fill' || type === 'select' || type === 'assertText') && !this.isElementId(action.targetElementId)) {
      action.targetElementId = input.observation.elements[0]?.id;
    }

    if (type === 'fill' && typeof action.value !== 'string') action.value = '{{uniqueName:inputValue:Agent QA}}';
    if (type === 'select' && !action.option) action.option = { index: 0 };
    if (type === 'press' && typeof action.key !== 'string') action.key = 'Escape';
    if (type === 'navigate' && typeof action.to !== 'string') action.to = input.config.baseUrl;
    if (type === 'clickAtCoordinates') {
      action.reason = String(action.reason).length >= 10 ? action.reason : 'coordinate fallback requested by model';
      action.risk = 'HIGH';
    }
    if (type === 'assertVisible' && !action.targetElementId && typeof action.text !== 'string') action.text = input.observation.visibleTexts[0] ?? input.observation.title;

    const parsed = QaActionEnvelopeSchema.shape.action.safeParse(action);
    if (parsed.success) return parsed.data;
    return { type: 'waitForStable', timeoutMs: 1000, reason };
  }

  private repairExpected(raw: unknown, input: DecisionInput): ExpectedAfterAction {
    const expected = typeof raw === 'object' && raw ? { ...(raw as Record<string, unknown>) } : {};
    if ('targetElementId' in expected) {
      const normalized = this.normalizeElementId(expected.targetElementId, input);
      if (normalized) expected.targetElementId = normalized;
      else delete expected.targetElementId;
    }
    const parsed = QaActionEnvelopeSchema.shape.expected_after_action.safeParse(expected);
    if (parsed.success) return parsed.data;
    return { type: 'no_console_errors' };
  }

  private normalizeElementId(value: unknown, input: DecisionInput): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value).trim();
    if (this.isElementId(text)) return this.hasElement(input, text) ? text : undefined;
    const number = /(?:el_?)?(\d{1,3})$/i.exec(String(value).trim())?.[1];
    if (number) {
      const id = `el_${String(Number(number)).padStart(3, '0')}`;
      if (this.hasElement(input, id)) return id;
    }
    return undefined;
  }

  private isElementId(value: unknown): value is string {
    return typeof value === 'string' && /^el_\d{3}$/.test(value);
  }

  private hasElement(input: DecisionInput, id: string): boolean {
    return input.observation.elements.some((e) => e.id === id);
  }

  private abortEnvelope(input: DecisionInput, error: unknown): QaActionEnvelope {
    return {
      schemaVersion: 'action.v1',
      observationId: input.observation.observationId,
      thought_summary: 'LLM returned invalid action schema after retries.',
      action: { type: 'abortScenario', reason: this.errorReason(error) },
      expected_after_action: { type: 'no_console_errors' },
      fallback_action: { type: 'waitForStable', timeoutMs: 1000, reason: 'finish invalid LLM response safely' },
      confidence: 0,
    };
  }

  private errorReason(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `Invalid LLM action schema: ${message.slice(0, 180)}`;
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

interface GroqChatResponse {
  choices: Array<{ message: { content: string } }>;
}
