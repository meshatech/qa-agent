import { Inject, Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';
import type { ObservableElement, ScreenObservation } from '../../domain/schemas/observation.schema.js';
import { AxTreeCollector } from './ax-tree.collector.js';
import { DomPurifier } from './dom-purifier.js';
import { PageStateDetector } from './page-state.detector.js';
import type { SignalsBuffer } from './signals-buffer.js';

const MAX_ELEMENTS = 80;
const MAX_TEXTS = 60;

@Injectable()
export class ObservationService {
  constructor(
    @Inject(AxTreeCollector) private readonly ax: AxTreeCollector,
    @Inject(DomPurifier) private readonly dom: DomPurifier,
    @Inject(PageStateDetector) private readonly state: PageStateDetector,
  ) {}

  async observe(page: Page, signals: SignalsBuffer): Promise<ScreenObservation> {
    const [axResult, domElements, pageState, title, visibleTexts] = await Promise.all([
      this.ax.collect(page),
      this.dom.fallbackElements(page).catch(() => [] as ObservableElement[]),
      this.state.detect(page),
      page.title(),
      page.locator('body').innerText().catch(() => '').then((text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_TEXTS)),
    ]);

    const merged = this.merge(axResult.elements, domElements);
    const elements = merged.slice(0, MAX_ELEMENTS).map((el, i) => ({ ...el, id: `el_${String(i + 1).padStart(3, '0')}` }));

    return {
      observationId: `obs_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      url: page.url(),
      title,
      visibleTexts,
      elements,
      pageState,
      consoleSignals: signals.console.slice(-20),
      networkSignals: signals.network.slice(-50),
      meta: {
        viewport: page.viewportSize() ?? { width: 1280, height: 720 },
        schemaVersion: 'obs.v1',
        accessibilitySource: axResult.source,
        accessibilityNodeCount: this.countAxNodes(axResult.tree),
      },
    };
  }

  private countAxNodes(node: { children: unknown[] } | null): number {
    if (!node) return 0;
    return 1 + node.children.reduce<number>((total, child) => total + this.countAxNodes(child as { children: unknown[] }), 0);
  }

  private merge(ax: ObservableElement[], dom: ObservableElement[]): ObservableElement[] {
    const out: ObservableElement[] = [];
    const seen = new Set<string>();
    const key = (e: ObservableElement) => `${e.role}::${e.name.toLowerCase()}`;

    for (const el of ax) {
      const k = key(el);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(el);
    }

    for (const el of dom) {
      const k = key(el);
      if (seen.has(k)) {
        const idx = out.findIndex((x) => key(x) === k);
        if (idx >= 0) {
          const merged: ObservableElement = {
            ...out[idx]!,
            placeholder: out[idx]!.placeholder ?? el.placeholder,
            value: out[idx]!.value ?? el.value,
            options: out[idx]!.options ?? el.options,
            bounds: out[idx]!.bounds ?? el.bounds,
            locator: this.preferLocator(out[idx]!.locator, el.locator),
            inViewport: out[idx]!.inViewport || el.inViewport,
          };
          out[idx] = merged;
        }
        continue;
      }
      seen.add(k);
      out.push(el);
    }
    return out;
  }

  private preferLocator(a: LocatorDescriptor, b: LocatorDescriptor): LocatorDescriptor {
    const order: Record<LocatorDescriptor['strategy'], number> = { testid: 0, label: 1, placeholder: 2, role: 3, text_any: 4, text: 5, semantic: 6, document: 7 };
    return order[a.strategy] <= order[b.strategy] ? a : b;
  }
}
