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
}
