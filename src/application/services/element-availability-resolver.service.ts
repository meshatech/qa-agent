import { Inject, Injectable } from '@nestjs/common';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { LocatorDescriptor, QaAction } from '../../domain/schemas/action.schema.js';
import type { PlanAction, PlanCondition } from '../../domain/schemas/execution-plan.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import { LocatorResolverService } from './locator-resolver.service.js';

export interface SemanticContainerDescriptor {
  semanticKey: string;
  openAction: PlanAction;
  expectedState?: PlanCondition;
}

export interface EnsureElementAvailablePolicy {
  enabled: boolean;
  maxOpenAttempts: number;
  allowedContainers: SemanticContainerDescriptor[];
  allowGlobalEscape?: boolean;
  allowClickOutside?: boolean;
}

export interface EnsureElementAvailableResult {
  available: boolean;
  observation: ScreenObservation;
  openedContainer?: string;
  reobserved: boolean;
  reason: 'FOUND_DIRECTLY' | 'FOUND_AFTER_OPEN_CONTAINER' | 'NOT_FOUND' | 'POLICY_DISABLED' | 'MAX_ATTEMPTS_EXCEEDED';
  attempts: Array<{ actionType: string; result: 'PASSED' | 'FAILED'; reason?: string; ts: string }>;
}

@Injectable()
export class ElementAvailabilityResolver {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject(LocatorResolverService) private readonly locators: LocatorResolverService,
  ) {}

  async ensureAvailable(input: { target: LocatorDescriptor; observation: ScreenObservation; policy: EnsureElementAvailablePolicy; config: RunConfig }): Promise<EnsureElementAvailableResult> {
    const attempts: EnsureElementAvailableResult['attempts'] = [];
    const targetLabel = JSON.stringify(input.target);

    console.log(`[ElementAvailability] ensureAvailable start target=${targetLabel} observationId=${input.observation.observationId}`);

    // Use the target immediately when it is already visible — re-opening a container toggles menus
    // and can trigger spurious navigation or extra browser tabs.
    if (this.exists(input.observation, input.target)) {
      console.log(`[ElementAvailability] FOUND_DIRECTLY target=${targetLabel} (no container open)`);
      return { available: true, observation: input.observation, reobserved: false, reason: 'FOUND_DIRECTLY', attempts };
    }
    if (!input.policy.enabled) {
      console.log(`[ElementAvailability] POLICY_DISABLED target=${targetLabel}`);
      return { available: false, observation: input.observation, reobserved: false, reason: 'POLICY_DISABLED', attempts };
    }

    let current = input.observation;
    for (let i = 0; i < input.policy.maxOpenAttempts; i++) {
      const container = this.pickContainer(input.target, input.policy.allowedContainers);
      if (!container) {
        // No container matches, check direct existence
        if (this.exists(current, input.target)) {
          console.log(`[ElementAvailability] FOUND_DIRECTLY after loop target=${targetLabel}`);
          return { available: true, observation: current, reobserved: current !== input.observation, reason: 'FOUND_DIRECTLY', attempts };
        }
        break;
      }
      const action = this.resolvePlanAction(container.openAction, current);
      if (!action) {
        console.log(`[ElementAvailability] container action unresolved semanticKey=${container.semanticKey}`);
        break;
      }
      console.log(`[ElementAvailability] opening container=${container.semanticKey} attempt=${i + 1} action=${JSON.stringify({ type: action.type, reason: 'reason' in action ? action.reason : undefined, targetElementId: 'targetElementId' in action ? action.targetElementId : undefined })}`);
      const exec = await this.browser.execute(action);
      attempts.push({ actionType: action.type, result: exec.ok ? 'PASSED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() });
      await this.browser.waitForQuiescence(input.config.timeouts.quiescenceMs).catch(() => undefined);
      current = await this.browser.observe();
      this.locators.rebuild(current);
      if (this.exists(current, input.target)) {
        console.log(`[ElementAvailability] FOUND_AFTER_OPEN_CONTAINER container=${container.semanticKey} target=${targetLabel}`);
        return { available: true, observation: current, openedContainer: container.semanticKey, reobserved: true, reason: 'FOUND_AFTER_OPEN_CONTAINER', attempts };
      }
    }
    console.log(`[ElementAvailability] NOT_FOUND target=${targetLabel}`);
    return { available: false, observation: current, reobserved: current !== input.observation, reason: input.policy.maxOpenAttempts <= 0 ? 'MAX_ATTEMPTS_EXCEEDED' : 'NOT_FOUND', attempts };
  }

  private exists(obs: ScreenObservation, target: LocatorDescriptor): boolean {
    try {
      this.locators.findByLocator(obs, target);
      return true;
    } catch {
      return false;
    }
  }

  private pickContainer(target: LocatorDescriptor, containers: SemanticContainerDescriptor[]): SemanticContainerDescriptor | undefined {
    const targetTexts = this.extractLocatorTexts(target).map((t) => t.toLowerCase());
    const keywordMappings: { keywords: string[]; containerKeys: string[] }[] = [
      { keywords: ['sair', 'logout', 'sign out', 'deslogar'], containerKeys: ['account_menu', 'user_menu', 'profile_menu'] },
      { keywords: ['tema', 'theme', 'aparência', 'appearance'], containerKeys: ['settings_menu', 'theme_menu', 'appearance_menu'] },
      { keywords: ['conta', 'account', 'perfil', 'profile'], containerKeys: ['account_menu', 'user_menu', 'profile_menu'] },
      { keywords: ['menu', 'opções', 'options'], containerKeys: ['main_menu', 'options_menu'] },
    ];
    for (const mapping of keywordMappings) {
      if (targetTexts.some((t) => mapping.keywords.some((k) => t.includes(k)))) {
        const match = containers.find((c) => mapping.containerKeys.includes(c.semanticKey));
        if (match) return match;
      }
    }
    return containers[0];
  }

  private extractLocatorTexts(target: LocatorDescriptor): string[] {
    const texts: string[] = [];
    if ('texts' in target && Array.isArray(target.texts)) {
      texts.push(...target.texts);
    }
    if ('text' in target && typeof target.text === 'string') {
      texts.push(target.text);
    }
    if ('name' in target && typeof target.name === 'string') {
      texts.push(target.name);
    }
    if ('semanticKey' in target && typeof target.semanticKey === 'string') {
      texts.push(target.semanticKey);
    }
    if ('intent' in target && typeof target.intent === 'string') {
      texts.push(target.intent);
    }
    if ('candidates' in target && Array.isArray(target.candidates)) {
      for (const candidate of target.candidates) {
        texts.push(...this.extractLocatorTexts(candidate));
      }
    }
    return texts;
  }

  private resolvePlanAction(action: PlanAction, obs: ScreenObservation): QaAction | undefined {
    if (!('target' in action)) return action as QaAction;
    if (!action.target) return action.type === 'press' ? { type: 'press', key: action.key, reason: action.reason } : undefined;
    try {
      const targetElementId = this.locators.findByLocator(obs, action.target);
      if (action.type === 'click') return { type: 'click', targetElementId, reason: action.reason };
      if (action.type === 'fill') return { type: 'fill', targetElementId, value: action.value, reason: action.reason };
      if (action.type === 'select') return { type: 'select', targetElementId, option: action.option, reason: action.reason };
      if (action.type === 'press') return { type: 'press', key: action.key, targetElementId, reason: action.reason };
      if (action.type === 'assertVisible') return { type: 'assertVisible', targetElementId, text: action.text, reason: action.reason };
      return undefined;
    } catch {
      return undefined;
    }
  }
}
