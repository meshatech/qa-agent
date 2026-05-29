import { describe, expect, it } from 'vitest';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import type { LocatorDescriptor } from '../src/domain/schemas/action.schema.js';
import type { ObservableElement, ScreenObservation } from '../src/domain/schemas/observation.schema.js';

const obs = (id: string): ScreenObservation => ({
  observationId: id,
  createdAt: new Date().toISOString(),
  url: 'http://local',
  title: '',
  visibleTexts: [],
  elements: [{ id: 'el_001', role: 'textbox', name: 'Nome', inViewport: true, locator: { strategy: 'label', text: 'Nome' } }],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1, height: 1 }, schemaVersion: 'obs.v1' },
});

const element = (overrides: Partial<ObservableElement> & { id: string; name: string; role?: string }): ObservableElement => ({
  id: overrides.id,
  role: overrides.role ?? 'button',
  name: overrides.name,
  text: overrides.text,
  inViewport: overrides.inViewport ?? true,
  locator: overrides.locator ?? { strategy: 'role', role: overrides.role ?? 'button', name: overrides.name },
  ariaLabel: overrides.ariaLabel,
  title: overrides.title,
  alt: overrides.alt,
  className: overrides.className,
});

const obsWithElements = (elements: ObservableElement[]): ScreenObservation => ({
  ...obs('obs_tokens'),
  elements,
});

describe('LocatorResolverService', () => {
  it('resolves current observation', () => {
    const resolver = new LocatorResolverService();
    resolver.rebuild(obs('obs_a'));
    expect(resolver.resolve('obs_a', 'el_001').humanName).toBe('Nome');
  });

  it('rejects stale observation', () => {
    const resolver = new LocatorResolverService();
    resolver.rebuild(obs('obs_a'));
    expect(() => resolver.resolve('obs_b', 'el_001')).toThrow(/current/);
  });

  it('uses token overlap as fallback for multi-token targets', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', name: 'Open settings panel', locator: { strategy: 'role', role: 'button', name: 'Settings' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text', text: 'open panel' };
    expect(resolver.findByLocator(observation, locator)).toBe('el_001');
  });

  it('does not use token overlap for single-token targets when there is no exact/includes match', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', name: 'Exit profile', locator: { strategy: 'role', role: 'button', name: 'Profile' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text', text: 'logout' };
    expect(() => resolver.findByLocator(observation, locator)).toThrow(/Element not found/);
  });

  it('does not match token substrings during token overlap fallback', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', name: 'chair action logout', locator: { strategy: 'role', role: 'button', name: 'Chair' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text', text: 'air logout' };
    expect(() => resolver.findByLocator(observation, locator)).toThrow(/Element not found/);
  });

  it('prefers exact locator matching over token overlap fallback', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', name: 'Settings panel', locator: { strategy: 'role', role: 'button', name: 'Settings panel' } }),
      element({ id: 'el_002', name: 'Settings panel fallback', locator: { strategy: 'role', role: 'link', name: 'Settings panel fallback' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'role', role: 'button', name: 'Settings panel' };
    expect(resolver.findByLocator(observation, locator)).toBe('el_001');
  });

  it('prefers actionable elements when token overlap scores tie', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', role: 'generic', name: 'Settings panel extra', locator: { strategy: 'text', text: 'decorative settings panel extra' } }),
      element({ id: 'el_002', role: 'button', name: 'Settings panel extra', locator: { strategy: 'text', text: 'actionable settings panel extra' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text', text: 'settings extra panel' };
    expect(resolver.findByLocator(observation, locator)).toBe('el_002');
  });

  it('does not resolve ambiguous token overlap when matches have close scores and same actionability', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', role: 'button', name: 'Settings primary panel', locator: { strategy: 'text', text: 'settings primary panel' } }),
      element({ id: 'el_002', role: 'button', name: 'Settings secondary panel', locator: { strategy: 'text', text: 'settings secondary panel' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text', text: 'settings panel' };
    expect(() => resolver.findByLocator(observation, locator)).toThrow(/Element not found/);
  });

  it('does not use className for generic semantic text matching', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', name: 'Unrelated', className: 'logout-button', locator: { strategy: 'role', role: 'button', name: 'Unrelated' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text_any', texts: ['logout'] };
    expect(() => resolver.findByLocator(observation, locator)).toThrow(/Element not found/);
  });

  it('ignores empty token overlap targets', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', name: 'Anything', locator: { strategy: 'text', text: 'Anything' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text', text: ' ' };
    expect(() => resolver.findByLocator(observation, locator)).toThrow(/Element not found/);
  });

  it('does not match single-token expected as substring of element text', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', name: 'okay button', locator: { strategy: 'text', text: 'okay button' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text', text: 'ok' };
    expect(() => resolver.findByLocator(observation, locator)).toThrow(/Element not found/);
  });

  it('matches single-token expected when it is an isolated word', () => {
    const resolver = new LocatorResolverService();
    const observation = obsWithElements([
      element({ id: 'el_001', name: 'press ok', locator: { strategy: 'text', text: 'press ok' } }),
    ]);
    const locator: LocatorDescriptor = { strategy: 'text', text: 'ok' };
    expect(resolver.findByLocator(observation, locator)).toBe('el_001');
  });
});
