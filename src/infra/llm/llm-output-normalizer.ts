import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ExecutionPlanSchema, PlanConditionSchema, PlanPatchSchema, type ExecutionPlan, type PlanPatch } from '../../domain/schemas/execution-plan.schema.js';

export type LlmWrapperKind = 'direct' | 'plan' | 'executionPlan' | 'patch' | 'patches';

@Injectable()
export class LlmOutputSanitizer {
  sanitize(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]').replace(/api[_-]?key["']?\s*[:=]\s*["'][^"']+["']/gi, 'apiKey:"[REDACTED]"');
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [/password|token|secret|cookie|authorization/i.test(key) ? [key, '[REDACTED]'] : [key, this.sanitize(item)]]));
  }
}

@Injectable()
export class JsonObjectExtractor {
  extract(text: string): string {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const first = stripped.search(/[{[]/);
    if (first < 0) return stripped;
    const open = stripped[first]!;
    const close = open === '{' ? '}' : ']';
    const last = stripped.lastIndexOf(close);
    return last >= first ? stripped.slice(first, last + 1) : stripped;
  }
}

@Injectable()
export class SafeJsonParser {
  constructor(private readonly extractor: JsonObjectExtractor) {}

  parse(text: string): unknown {
    return JSON.parse(this.extractor.extract(text));
  }
}

@Injectable()
export class LlmPlanPatchNormalizer {
  parsePlan(raw: string | unknown): { value: ExecutionPlan; wrapper: LlmWrapperKind } {
    const input = typeof raw === 'string' ? JSON.parse(new JsonObjectExtractor().extract(raw)) : raw;
    const { candidate, wrapper } = this.unwrapPlan(input);
    return { value: ExecutionPlanSchema.parse(this.repairPlan(candidate)), wrapper };
  }

  parsePatch(raw: string | unknown): { value: PlanPatch; wrapper: LlmWrapperKind } {
    const input = typeof raw === 'string' ? JSON.parse(new JsonObjectExtractor().extract(raw)) : raw;
    const { candidate, wrapper } = this.unwrapPatch(input);
    return { value: PlanPatchSchema.parse(candidate), wrapper };
  }

  private unwrapPlan(raw: unknown): { candidate: unknown; wrapper: LlmWrapperKind } {
    const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    if (obj.plan) return { candidate: obj.plan, wrapper: 'plan' };
    if (obj.executionPlan) return { candidate: obj.executionPlan, wrapper: 'executionPlan' };
    return { candidate: raw, wrapper: 'direct' };
  }

  private unwrapPatch(raw: unknown): { candidate: unknown; wrapper: LlmWrapperKind } {
    const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    if (obj.patch) return { candidate: obj.patch, wrapper: 'patch' };
    if (Array.isArray(obj.patches)) {
      const candidate = obj.patches.find((patch) => PlanPatchSchema.safeParse(patch).success);
      if (!candidate) throw new z.ZodError([{ code: 'custom', path: ['patches'], message: 'No valid PlanPatch found in patches wrapper', input: obj.patches }]);
      return { candidate, wrapper: 'patches' };
    }
    return { candidate: raw, wrapper: 'direct' };
  }

  private repairPlan(candidate: unknown): unknown {
    if (!candidate || typeof candidate !== 'object') return candidate;
    const plan = { ...(candidate as Record<string, unknown>) };
    if (Array.isArray(plan.steps)) plan.steps = plan.steps.map((step, index) => this.repairStep(step, index));
    if (Array.isArray(plan.assertions)) plan.assertions = plan.assertions.map((condition) => this.repairCondition(condition)).filter(Boolean);
    return plan;
  }

  private repairStep(step: unknown, index: number): unknown {
    if (!step || typeof step !== 'object') return step;
    const item = { ...(step as Record<string, unknown>) };
    item.id = typeof item.id === 'string' && item.id.trim() ? item.id : `S${String(index + 1).padStart(3, '0')}`;
    item.description = typeof item.description === 'string' && item.description.trim() ? item.description : `Execution step ${index + 1}`;
    item.preconditions = Array.isArray(item.preconditions) ? item.preconditions.map((condition) => this.repairCondition(condition)).filter(Boolean) : [];
    item.action = this.repairAction(item.action, item.description);
    const postconditions = Array.isArray(item.postconditions) ? item.postconditions : [item.postcondition].filter(Boolean);
    item.postconditions = postconditions.map((condition) => this.repairCondition(condition)).filter(Boolean);
    item.assertions = Array.isArray(item.assertions) ? item.assertions.map((condition) => this.repairCondition(condition)).filter(Boolean) : [];
    item.onFailure = typeof item.onFailure === 'string' ? item.onFailure : 'RECOVER';
    delete item.postcondition;
    return item;
  }

  private repairAction(action: unknown, fallbackReason: unknown): unknown {
    if (!action || typeof action !== 'object') return action;
    const item = { ...(action as Record<string, unknown>) };
    item.reason = typeof item.reason === 'string' && item.reason.trim() ? item.reason : String(fallbackReason || 'execute planned step');
    if (!item.target && item.locator) item.target = item.locator;
    if (item.target) item.target = this.repairLocator(item.target, fallbackReason);
    if (item.type === 'navigate' && typeof item.to !== 'string') {
      const target = item.target && typeof item.target === 'object' ? item.target as Record<string, unknown> : {};
      item.to = typeof item.url === 'string' ? item.url : typeof target.url === 'string' ? target.url : typeof target.value === 'string' ? target.value : '/';
      delete item.target;
    }
    if (item.type === 'waitForStable' || item.type === 'clickOutside' || item.type === 'abortScenario') delete item.target;
    if (item.type === 'fill' && typeof item.value !== 'string') item.value = this.repairActionValue(item.value);
    delete item.locator;
    delete item.postcondition;
    return item;
  }

  private repairActionValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      const key = typeof item.key === 'string' ? item.key : typeof item.name === 'string' ? item.name : 'value';
      const prefix = typeof item.prefix === 'string' ? item.prefix : 'Agent QA';
      const generator = String(item.generator ?? item.type ?? '').toLowerCase();
      if (generator.includes('email')) return `{{uniqueEmail:${key}}}`;
      if (generator.includes('unique') || generator.includes('name')) return `{{uniqueName:${key}:${prefix}}}`;
      if (typeof item.value === 'string') return item.value;
      if (typeof item.text === 'string') return item.text;
    }
    return String(value ?? '');
  }

  private repairCondition(condition: unknown): unknown {
    if (!condition || typeof condition !== 'object') return condition;
    const item = { ...(condition as Record<string, unknown>) };
    if (!item.target && item.locator) item.target = item.locator;
    if (item.target) item.target = this.repairLocator(item.target, item.semanticKey ?? item.type);
    item.type = this.normalizeConditionType(item.type);
    if (item.type === 'element_visible' && !item.text && !item.target) item.text = this.stringField(item, ['text', 'name', 'value', 'label']);
    if (item.type === 'text_visible' && typeof item.text !== 'string') item.text = this.stringField(item, ['text', 'name', 'value', 'label']);
    if (item.type === 'text_any_visible' && !Array.isArray(item.texts)) {
      const texts = Array.isArray(item.values) ? item.values : Array.isArray(item.value) ? item.value : Array.isArray(item.text) ? item.text : [];
      item.texts = texts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    }
    if (item.type === 'url_contains' && typeof item.value !== 'string') item.value = this.stringField(item, ['value', 'url', 'expectedUrl', 'expectedUrlPattern', 'contains']);
    if (item.type === 'auth_state' && typeof item.expected !== 'string') item.expected = this.stringField(item, ['expected', 'value', 'state']) || 'anonymous';
    if (item.type === 'text_any' && Array.isArray(item.texts)) item.type = 'text_any_visible';
    if (item.type === 'text' && typeof item.text === 'string') item.type = 'text_visible';
    if (item.type === 'ui_state') {
      item.semanticKey = typeof item.semanticKey === 'string' ? item.semanticKey : 'appearance_mode';
      const rawExpected = typeof item.expected === 'string' || typeof item.expected === 'boolean' || typeof item.expected === 'number' ? item.expected : undefined;
      item.expected = rawExpected === 'changed' ? 'exists' : (rawExpected ?? 'exists');
      delete item.target;
      delete item.value;
    }
    if (item.type === 'route_state') {
      const expected = typeof item.expected === 'string' ? item.expected : undefined;
      if (!expected || !['changed', 'same', 'matches'].includes(expected)) {
        item.expected = typeof item.expectedUrl === 'string' || typeof item.expectedUrlPattern === 'string' ? 'matches' : 'changed';
      }
    }
    if (item.type === 'field_value_contains' && typeof item.value !== 'string') item.value = this.repairActionValue(item.value);
    delete item.locator;
    if (['element_visible', 'text_visible', 'text_any_visible', 'url_contains', 'auth_state'].includes(String(item.type))) {
      delete item.name;
      delete item.label;
      delete item.values;
    }
    if (['element_visible', 'text_visible', 'text_any_visible', 'auth_state'].includes(String(item.type))) {
      delete item.value;
      delete item.url;
      delete item.contains;
    }
    return PlanConditionSchema.safeParse(item).success ? item : undefined;
  }

  private normalizeConditionType(type: unknown): unknown {
    if (typeof type !== 'string') return type;
    const normalized = type.toLowerCase().replace(/[\s-]+/g, '_');
    if (['visible', 'element', 'element_is_visible', 'is_visible'].includes(normalized)) return 'element_visible';
    if (['text', 'text_contains', 'text_is_visible', 'contains_text'].includes(normalized)) return 'text_visible';
    if (['text_any', 'any_text_visible', 'one_of_texts_visible'].includes(normalized)) return 'text_any_visible';
    if (['url', 'url_includes', 'url_matches'].includes(normalized)) return 'url_contains';
    if (['route', 'route_contains', 'route_matches', 'url_state'].includes(normalized)) return 'route_state';
    if (['auth', 'authentication_state'].includes(normalized)) return 'auth_state';
    if (['menu', 'menu_open', 'menu_closed'].includes(normalized)) return 'menu_state';
    return type;
  }

  private stringField(item: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return undefined;
  }

  private repairLocator(locator: unknown, fallbackIntent: unknown): unknown {
    if (typeof locator === 'string' && locator.trim()) return { strategy: 'text', text: locator };
    if (!locator || typeof locator !== 'object') return locator;
    const item = { ...(locator as Record<string, unknown>) };
    if (item.strategy === 'semantic') {
      item.semanticKey = typeof item.semanticKey === 'string' && item.semanticKey.trim() ? item.semanticKey : 'semantic_action';
      item.intent = typeof item.intent === 'string' && item.intent.trim() ? item.intent : String(fallbackIntent || item.semanticKey);
      const candidates = Array.isArray(item.candidates) ? item.candidates : [];
      const repairedCandidates = candidates
        .map((candidate) => this.repairLocator(candidate, item.intent))
        .filter((candidate) => candidate && typeof candidate === 'object');
      item.candidates = repairedCandidates;
      if (repairedCandidates.length === 0) {
        const text = this.stringField(item, ['text', 'name', 'label', 'value']);
        if (text) item.candidates = [{ strategy: 'text', text }];
      }
    }
    if (item.strategy === 'text_any' && !Array.isArray(item.texts)) {
      const texts = Array.isArray(item.value) ? item.value : Array.isArray(item.text) ? item.text : [];
      item.texts = texts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    }
    return item;
  }
}
