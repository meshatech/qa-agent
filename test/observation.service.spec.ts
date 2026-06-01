import { describe, expect, it } from 'vitest';
import { ObservationService } from '../src/infra/observation/observation.service.js';
import { AxTreeCollector } from '../src/infra/observation/ax-tree.collector.js';
import { DomPurifier } from '../src/infra/observation/dom-purifier.js';
import { PageStateDetector } from '../src/infra/observation/page-state.detector.js';
import type { ObservableElement } from '../src/domain/schemas/observation.schema.js';

function element(role: string, name: string, inViewport = true): ObservableElement {
  return {
    id: 'el_001',
    role,
    name,
    inViewport,
    locator: { strategy: 'role', role: 'button', name },
  };
}

describe('ObservationService', () => {
  it('prioritizes form inputs first, interactive controls second, and preserves original order on ties', () => {
    const service = new ObservationService(
      new AxTreeCollector(),
      new DomPurifier(),
      new PageStateDetector(),
    ) as unknown as { prioritizeElements(elements: ObservableElement[]): ObservableElement[] };

    const ordered = service.prioritizeElements([
      element('generic', 'Container'),
      element('button', 'Salvar'),
      element('textbox', 'Nome'),
      element('link', 'Ajuda'),
      element('searchbox', 'Buscar', false),
      element('button', 'Cancelar', false),
      element('textbox', 'Email', false),
      element('generic', 'Footer', false),
    ]);

    expect(ordered.map((item) => item.name)).toEqual([
      'Nome',
      'Buscar',
      'Email',
      'Salvar',
      'Ajuda',
      'Cancelar',
      'Container',
      'Footer',
    ]);
  });
});
