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
    const found = obs.elements.find((element) => this.sameLocator(element.locator, locator))
      ?? obs.elements.find((element) => this.sameElement(element, locator))
      ?? this.bestTokenOverlap(obs, locator);
    if (!found) throw new DomainError('LOCATOR_NOT_FOUND', `Element not found for locator: ${JSON.stringify(locator)}`);
    return found.id;
  }

  private sameLocator(a: LocatorDescriptor, b: LocatorDescriptor): boolean {
    if (a.strategy !== b.strategy) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private sameElement(element: ScreenObservation['elements'][number], locator: LocatorDescriptor): boolean {
    if (locator.strategy === 'role') {
      if (element.role !== locator.role) return false;
      if (!locator.name) return true;
      return this.includes(element.name, locator.name) || this.includes(element.text, locator.name);
    }
    if (locator.strategy === 'text') return this.includes(element.name, locator.text) || this.includes(element.text, locator.text);
    if (locator.strategy === 'text_any') {
      return locator.texts.some((text) =>
        this.includes(element.name, text) ||
        this.includes(element.text, text) ||
        this.includes(element.ariaLabel, text) ||
        this.includes(element.title, text) ||
        this.includes(element.alt, text)
      );
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
    return ACTIONABLE_ROLES.has(element.role.toLowerCase()) ? 1 : 0;
  }
}
