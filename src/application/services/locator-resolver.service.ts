import { Injectable } from '@nestjs/common';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import { DomainError } from '../../domain/shared/result.js';

@Injectable()
export class LocatorResolverService {
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
    const found = obs.elements.find((element) => this.sameLocator(element.locator, locator)) ?? obs.elements.find((element) => this.sameElement(element, locator));
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
    if (locator.strategy === 'text_any') return locator.texts.some((text) => this.includes(element.name, text) || this.includes(element.text, text));
    if (locator.strategy === 'label' || locator.strategy === 'placeholder') {
      return this.includes(element.name, locator.text) || this.includes(element.text, locator.text);
    }
    if (locator.strategy === 'testid') return this.includes(element.name, locator.value) || this.includes(element.text, locator.value);
    return false;
  }

  private includes(value: string | undefined, expected: string): boolean {
    return value?.toLowerCase().includes(expected.toLowerCase()) ?? false;
  }
}
