import { Injectable, Logger } from '@nestjs/common';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import { DomainError } from '../../domain/shared/result.js';

const ACTIONABLE_ROLES = new Set(['button', 'link', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'tab', 'textbox', 'combobox']);
const MIN_TOKEN_OVERLAP = 0.75;

@Injectable()
export class LocatorResolverService {
  private readonly logger = new Logger(LocatorResolverService.name);
  private observationId = '';
  private readonly map = new Map<string, LocatorDescriptor>();
  private readonly names = new Map<string, string>();

  rebuild(obs: ScreenObservation): void {
    this.observationId = obs.observationId;
    this.map.clear();
    this.names.clear();
    obs.elements.forEach((e) => {
      this.map.set(e.id, e.locator);
      this.names.set(e.id, e.name);
    });
  }

  resolve(observationId: string, elementId: string): { locator: LocatorDescriptor; humanName?: string } {
    if (observationId !== this.observationId) throw new DomainError('STALE_OBSERVATION', 'Observation is no longer current');
    const locator = this.map.get(elementId);
    if (!locator) throw new DomainError('LOCATOR_NOT_FOUND', `Element not found: ${elementId}`);
    return { locator, humanName: this.names.get(elementId) };
  }

  findByLocator(obs: ScreenObservation, locator: LocatorDescriptor): string {
    if (locator.strategy === 'semantic') {
      for (const candidate of locator.candidates) {
        try {
          return this.findByLocator(obs, candidate);
        } catch {
          // Try next candidate.
        }
      }
      throw new DomainError('LOCATOR_NOT_FOUND', `Element not found for semantic locator: ${locator.semanticKey}`);
    }
    if (locator.strategy === 'index') {
      const matches = obs.elements.filter((element) => this.sameLocator(element.locator, locator.target) || this.sameElement(element, locator.target));
      const found = matches[locator.index];
      if (!found) throw new DomainError('LOCATOR_NOT_FOUND', `Element not found for indexed locator: ${JSON.stringify(locator)}`);
      return found.id;
    }
    if (locator.strategy === 'text_any') {
      const ranked = this.rankTextAnyMatches(obs, locator);
      if (ranked) return ranked.id;
    }
    const found = obs.elements.find((element) => this.sameLocator(element.locator, locator))
      ?? obs.elements.find((element) => this.sameElement(element, locator))
      ?? this.bestTokenOverlap(obs, locator);
    if (!found) {
      // Smart fallback: when no semantic match, try heuristics for common interactive elements
      const fallback = this.smartFallback(obs, locator);
      if (fallback) {
        this.logger.warn(`Smart fallback used for locator ${JSON.stringify(locator)} → ${fallback.id}`);
        return fallback.id;
      }
      throw new DomainError('LOCATOR_NOT_FOUND', `Element not found for locator: ${JSON.stringify(locator)}`);
    }
    return found.id;
  }

  private sameLocator(a: LocatorDescriptor, b: LocatorDescriptor): boolean {
    if (a.strategy !== b.strategy) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private rankTextAnyMatches(obs: ScreenObservation, locator: Extract<LocatorDescriptor, { strategy: 'text_any' }>): ScreenObservation['elements'][number] | undefined {
    const matches = obs.elements
      .filter((element) => this.sameElement(element, locator))
      .filter((element) => !this.shouldExcludeTextAnyCandidate(element, locator.texts));
    if (!matches.length) return undefined;
    const ranked = matches
      .map((element) => ({ element, score: this.textAnyMatchScore(element, locator.texts) }))
      .sort((a, b) => b.score - a.score || this.actionableScore(b.element) - this.actionableScore(a.element));
    return ranked[0]?.element;
  }

  private textAnyMatchScore(element: ScreenObservation['elements'][number], texts: string[]): number {
    const haystack = [element.name, element.text, element.ariaLabel, element.title, element.alt]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();
    let best = 0;
    for (const text of texts) {
      const normalized = text.toLowerCase();
      if (haystack === normalized) best = Math.max(best, 100 + text.length);
      else if ((element.name ?? '').toLowerCase() === normalized) best = Math.max(best, 90 + text.length);
      else if (this.includes(element.name, text) || this.includes(element.text, text)) best = Math.max(best, 50 + text.length);
    }
    return best;
  }

  private sameElement(element: ScreenObservation['elements'][number], locator: LocatorDescriptor): boolean {
    if (locator.strategy === 'role') {
      if (element.role !== locator.role) return false;
      if (!locator.name) return true;
      return this.includes(element.name, locator.name) || this.includes(element.text, locator.name);
    }
    if (locator.strategy === 'text') return this.includes(element.name, locator.text) || this.includes(element.text, locator.text);
    if (locator.strategy === 'text_any') {
      return locator.texts.some((text) => {
        const expectedTokens = this.tokens(text);
        const nameTokens = new Set(this.tokens(element.name ?? ''));
        const textTokens = new Set(this.tokens(element.text ?? ''));
        const labelTokens = new Set(this.tokens(element.ariaLabel ?? ''));
        const titleTokens = new Set(this.tokens(element.title ?? ''));
        const altTokens = new Set(this.tokens(element.alt ?? ''));
        // Prevent false positive: e.g. expected="menu de conta ou configurações" (5 tokens)
        // matching value="Configurações" (1 token) because expected includes value as substring
        const hasEnoughTokens = (tokens: Set<string>) =>
          expectedTokens.length <= 1 || tokens.size >= expectedTokens.length ||
          expectedTokens.every((t) => tokens.has(t));
        if (!hasEnoughTokens(nameTokens) && !hasEnoughTokens(textTokens) &&
            !hasEnoughTokens(labelTokens) && !hasEnoughTokens(titleTokens) &&
            !hasEnoughTokens(altTokens)) {
          return false;
        }
        return this.includes(element.name, text) ||
          this.includes(element.text, text) ||
          this.includes(element.ariaLabel, text) ||
          this.includes(element.title, text) ||
          this.includes(element.alt, text);
      });
    }
    if (locator.strategy === 'label' || locator.strategy === 'placeholder') {
      return this.includes(element.name, locator.text) || this.includes(element.text, locator.text);
    }
    if (locator.strategy === 'testid') return this.includes(element.name, locator.value) || this.includes(element.text, locator.value);
    return false;
  }

  private includes(value: string | undefined, expected: string): boolean {
    if (!value) return false;
    const v = value.toLowerCase();
    const e = expected.toLowerCase();
    const expectedTokens = this.tokens(expected);
    if (expectedTokens.length === 1) {
      const valueTokens = new Set(this.tokens(value));
      return valueTokens.has(expectedTokens[0]);
    }
    return v.includes(e) || e.includes(v);
  }

  private bestTokenOverlap(obs: ScreenObservation, locator: LocatorDescriptor): ScreenObservation['elements'][number] | undefined {
    const expected = this.expectedTexts(locator);
    if (!expected.some((text) => this.tokens(text).length >= 2)) return undefined;
    const ranked = obs.elements
      .map((element) => ({ element, score: this.matchScore(element, expected) }))
      .filter((item) => item.score >= MIN_TOKEN_OVERLAP)
      .sort((a, b) => b.score - a.score || this.actionableScore(b.element) - this.actionableScore(a.element));
    const selected = ranked[0];
    const runnerUp = ranked[1];
    if (selected && runnerUp && selected.score - runnerUp.score < 0.2 && this.actionableScore(selected.element) === this.actionableScore(runnerUp.element)) {
      if (process.env.DEBUG_LOCATOR === 'true') {
        this.logger.warn(`ambiguous token overlap for expected=${JSON.stringify(expected)}; selected="${selected.element.id}" score=${selected.score}; runnerUp="${runnerUp.element.id}" score=${runnerUp.score}`);
      }
      return undefined;
    }
    if (selected && process.env.DEBUG_LOCATOR === 'true') {
      this.logger.debug(`token overlap selected element "${selected.element.id}" with score ${selected.score}; expected=${JSON.stringify(expected)}`);
    }
    return selected?.element;
  }

  private expectedTexts(locator: LocatorDescriptor): string[] {
    if (locator.strategy === 'text_any') return locator.texts;
    if (locator.strategy === 'text') return [locator.text];
    if (locator.strategy === 'label' || locator.strategy === 'placeholder') return [locator.text];
    if (locator.strategy === 'role' && locator.name) return [locator.name];
    if (locator.strategy === 'testid') return [locator.value];
    if (locator.strategy === 'semantic') return [locator.semanticKey, locator.intent];
    return [];
  }

  private matchScore(element: ScreenObservation['elements'][number], expectedTexts: string[]): number {
    const haystack = this.searchableText(element);
    const haystackTokens = new Set(this.tokens(haystack));
    if (!haystackTokens.size) return 0;
    return Math.max(...expectedTexts.map((expected) => this.overlapScore(this.tokens(expected), haystackTokens)));
  }

  private overlapScore(expectedTokens: string[], haystackTokens: Set<string>): number {
    if (expectedTokens.length < 2) return 0;
    const matched = expectedTokens.filter((token) => haystackTokens.has(token));
    return matched.length / expectedTokens.length;
  }

  private searchableText(element: ScreenObservation['elements'][number]): string {
    return [element.name, element.text, element.ariaLabel, element.title, element.alt, element.placeholder]
      .filter((value): value is string => Boolean(value))
      .join(' ');
  }

  private tokens(value: string): string[] {
    const normalized = value.toLocaleLowerCase().normalize('NFKC');
    const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'word' })
      : undefined;
    const parts = segmenter
      ? Array.from(segmenter.segment(normalized)).filter((part) => part.isWordLike).map((part) => part.segment)
      : normalized.split(' ');
    return Array.from(new Set(parts.map((part) => part.trim()).filter((part) => part.length > 1)));
  }

  private actionableScore(element: ScreenObservation['elements'][number]): number {
    const role = element.role.toLowerCase();
    if (role === 'switch' || role === 'menuitem') return 3;
    if (ACTIONABLE_ROLES.has(role)) return 1;
    return 0;
  }

  private shouldExcludeTextAnyCandidate(element: ScreenObservation['elements'][number], texts: string[]): boolean {
    const normalizedTexts = texts.map((text) => text.toLowerCase());
    const seeksMenuItem = normalizedTexts.some((text) => /^(tema|sair|logout|aparência|appearance|theme|escuro|dark)$/.test(text) || /tema|sair|logout|aparência/.test(text));
    if (!seeksMenuItem) return false;
    return this.isAccountMenuTrigger(element);
  }

  private isAccountMenuTrigger(element: ScreenObservation['elements'][number]): boolean {
    const name = (element.name ?? '').toLowerCase();
    return name.includes('conta e opções') || name === 'account' || name === 'configurações';
  }

  /**
   * Smart fallback when no semantic locator matches.
   * Uses heuristics to find the most likely interactive element:
   * 1. For fill/data_entry: largest editable element in viewport (contenteditable, input, textarea, generic div with large area)
   * 2. For click: largest clickable element in viewport center
   * 3. Default: element with largest area in viewport
   */
  private smartFallback(obs: ScreenObservation, locator: LocatorDescriptor): ScreenObservation['elements'][number] | undefined {
    const inViewport = obs.elements.filter((e) => e.inViewport);
    if (!inViewport.length) return undefined;

    const expectedTexts = this.expectedTexts(locator);
    const isDataEntry = expectedTexts.some((t) => /fill|type|input|enter|digitar|preencher|texto|campo/i.test(t));
    const isClick = expectedTexts.some((t) => /click|press|botão|button|link|menu/i.test(t));

    if (isDataEntry) {
      // Find largest editable element: textbox, combobox, or generic element with large area
      const editable = inViewport.filter((e) =>
        e.role === 'textbox' ||
        e.role === 'combobox' ||
        e.tagName === 'textarea' ||
        e.tagName === 'input' ||
        e.editable === true
      );
      if (editable.length) {
        return editable.sort((a, b) => this.area(b) - this.area(a))[0];
      }
      // Fallback: largest generic div/element that might be a custom editor
      const generic = inViewport.filter((e) => e.tagName === 'div' || e.tagName === 'section');
      if (generic.length) {
        return generic.sort((a, b) => this.area(b) - this.area(a))[0];
      }
    }

    if (isClick) {
      const clickable = inViewport.filter((e) =>
        ACTIONABLE_ROLES.has(e.role.toLowerCase()) || e.tagName === 'button' || e.tagName === 'a'
      );
      if (clickable.length) {
        // Sort by proximity to center + area
        const viewportCenter = { x: 683, y: 384 }; // approximate for 1366x768
        return clickable.sort((a, b) => {
          const scoreA = this.proximityScore(a, viewportCenter) + this.area(a) * 0.001;
          const scoreB = this.proximityScore(b, viewportCenter) + this.area(b) * 0.001;
          return scoreB - scoreA;
        })[0];
      }
    }

    return undefined;
  }

  private area(element: ScreenObservation['elements'][number]): number {
    const b = element.bounds;
    if (!b) return 0;
    return b.width * b.height;
  }

  private proximityScore(element: ScreenObservation['elements'][number], center: { x: number; y: number }): number {
    const b = element.bounds;
    if (!b) return 0;
    const elCenter = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const dist = Math.sqrt((elCenter.x - center.x) ** 2 + (elCenter.y - center.y) ** 2);
    return Math.max(0, 1000 - dist);
  }
}
