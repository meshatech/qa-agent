import { Inject, Injectable } from '@nestjs/common';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page, type Locator, type BrowserType } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserHarnessPort } from '../../application/ports/browser-harness.port.js';
import type { BoundExpectedAfterAction, LocatorDescriptor, QaAction } from '../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { ActionExecutionResult, AssertionResult, QuiescenceResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { PlanCondition, RuntimeStateSnapshot } from '../../domain/schemas/execution-plan.schema.js';
import { HarnessFatalError } from '../../domain/errors.js';
import { PlaywrightQuiescenceGuard } from './playwright-quiescence.guard.js';
import { ObservationService } from '../observation/observation.service.js';
import { SignalsCollector, type SignalsBuffer } from '../observation/signals-buffer.js';
import { FormLoginService } from './auth/form-login.js';

@Injectable()
export class PlaywrightHarness implements BrowserHarnessPort {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private config?: RunConfig;
  private inFlight = false;
  private signals: SignalsBuffer;
  private readonly locators = new Map<string, LocatorDescriptor>();
  private readonly videoDir = '.agent-qa-video';
  private pendingDialog?: { accept(promptText?: string): Promise<void>; dismiss(): Promise<void>; message(): string };

  constructor(
    @Inject(PlaywrightQuiescenceGuard) private readonly quiescence: PlaywrightQuiescenceGuard,
    @Inject(ObservationService) private readonly observation: ObservationService,
    @Inject(SignalsCollector) private readonly signalsCollector: SignalsCollector,
    @Inject(FormLoginService) private readonly formLogin: FormLoginService,
  ) {
    this.signals = this.signalsCollector.createBuffer();
  }

  async open(config: RunConfig): Promise<void> {
    try {
      this.config = config;
      const engine: BrowserType = config.browser.engine === 'firefox' ? firefox : config.browser.engine === 'webkit' ? webkit : chromium;
      this.browser = await engine.launch({ headless: !config.browser.headed, slowMo: config.browser.slowMoMs });
      await mkdir(this.videoDir, { recursive: true });
      await this.createContextAndPage(config);
      const page = this.mustPage();
      if (config.auth.kind === 'formLogin') await this.formLogin.login(page, config);
      await this.navigateWithRetry(config.baseUrl);
      await this.waitForQuiescence(config.timeouts.quiescenceMs).catch(() => undefined);
    } catch (error) {
      if (error instanceof HarnessFatalError) throw error;
      throw new HarnessFatalError(error instanceof Error ? error.message : 'browser open failed', error);
    }
  }

  async captureAuth(config: RunConfig, outputPath: string): Promise<void> {
    try {
      const engine: BrowserType = config.browser.engine === 'firefox' ? firefox : config.browser.engine === 'webkit' ? webkit : chromium;
      this.browser = await engine.launch({ headless: !config.browser.headed });
      this.context = await this.browser.newContext({ viewport: config.browser.viewport });
      this.page = await this.context.newPage();
      this.signals.reset();
      this.signalsCollector.attach(this.page, config, this.signals);
      await this.formLogin.login(this.page, config);
      await mkdir(dirname(outputPath), { recursive: true }).catch(() => undefined);
      await this.context.storageState({ path: outputPath });
    } catch (error) {
      if (error instanceof HarnessFatalError) throw error;
      throw new HarnessFatalError(error instanceof Error ? error.message : 'capture auth failed', error);
    }
  }

  async observe(): Promise<ScreenObservation> {
    try {
      const page = await this.ensurePage();
      const obs = await this.stableObservation(page);
      this.locators.clear();
      obs.elements.forEach((el) => this.locators.set(el.id, el.locator));
      return obs;
    } catch (error) {
      if (error instanceof HarnessFatalError) throw error;
      throw new HarnessFatalError(this.playwrightMessage(error), error);
    }
  }

  async execute(action: QaAction): Promise<ActionExecutionResult> {
    const started = Date.now();
    if (this.inFlight) return { ok: false, actionType: action.type, durationMs: 0, error: { code: 'CONCURRENT_ACTION_DENIED', message: 'Action already in flight' } };
    this.inFlight = true;
    let data: string | undefined;
    try {
      switch (action.type) {
        case 'fill': await this.byId(action.targetElementId).fill(action.value); break;
        case 'click': await this.clickAllowingPendingDialog(this.byId(action.targetElementId)); break;
        case 'press': {
          const target = action.targetElementId ? this.byId(action.targetElementId) : null;
          if (target) await target.press(action.key);
          else await this.mustPage().keyboard.press(action.key);
          break;
        }
        case 'clickOutside': {
          const viewport = this.mustPage().viewportSize();
          if (!viewport) await this.mustPage().keyboard.press('Escape');
          else await this.mustPage().mouse.click(10, 10);
          break;
        }
        case 'waitForStable': await this.waitForQuiescence(action.timeoutMs ?? 3000); break;
        case 'navigate': await this.navigateWithRetry(new URL(action.to, this.mustPage().url()).toString()); break;
        case 'drag': await this.byId(action.sourceElementId).dragTo(this.byId(action.targetElementId)); break;
        case 'uploadFile': await this.byId(action.targetElementId).setInputFiles(action.filePath); break;
        case 'waitForCondition': await this.mustPage().getByText(action.text).first().waitFor({ state: 'visible', timeout: action.timeoutMs ?? 10000 }); break;
        case 'compareScreenshot': {
          const result = await this.compareScreenshot(action.baselinePath, action.threshold);
          if (!result.ok) return { ok: false, actionType: action.type, durationMs: Date.now() - started, error: { code: 'ASSERTION_FAILED', message: `screenshot diff ratio ${result.diffRatio}` } };
          break;
        }
        case 'auditAccessibility': {
          const violations = await this.auditAccessibility();
          if (violations.some((item) => item.impact === 'critical')) return { ok: false, actionType: action.type, durationMs: Date.now() - started, error: { code: 'ASSERTION_FAILED', message: `critical accessibility violations: ${violations.map((item) => item.id).join(', ')}` } };
          break;
        }
        case 'acceptDialog': {
          if (!this.pendingDialog) throw new Error('No browser dialog is pending');
          if (action.text && !this.pendingDialog.message().includes(action.text)) throw new Error(`Unexpected dialog text: ${this.pendingDialog.message()}`);
          await this.pendingDialog.accept();
          this.pendingDialog = undefined;
          break;
        }
        case 'dismissDialog': {
          if (!this.pendingDialog) throw new Error('No browser dialog is pending');
          await this.pendingDialog.dismiss();
          this.pendingDialog = undefined;
          break;
        }
        case 'richTextFill': await this.fillRichText(this.byId(action.targetElementId), action.value); break;
        case 'extract': data = action.source === 'value' ? await this.byId(action.targetElementId).inputValue() : await this.byId(action.targetElementId).innerText(); break;
        case 'abortScenario': return { ok: false, actionType: action.type, durationMs: Date.now() - started };
        case 'select': await this.byId(action.targetElementId).selectOption('label' in action.option ? { label: action.option.label } : 'value' in action.option ? { value: action.option.value } : { index: action.option.index }); break;
        case 'clickAtCoordinates': await this.mustPage().mouse.click(action.x, action.y); break;
        case 'assertVisible': {
          const visible = action.targetElementId ? await this.byId(action.targetElementId).isVisible() : await this.mustPage().getByText(action.text!).isVisible();
          if (!visible) return { ok: false, actionType: action.type, durationMs: Date.now() - started, error: { code: 'ASSERTION_FAILED', message: 'element not visible' } };
          break;
        }
        case 'assertText': {
          const text = await this.byId(action.targetElementId).innerText();
          const ok = action.match === 'equals' ? text === action.expected : action.match === 'regex' ? new RegExp(action.expected).test(text) : text.includes(action.expected);
          if (!ok) return { ok: false, actionType: action.type, durationMs: Date.now() - started, error: { code: 'ASSERTION_FAILED', message: `expected ${action.expected}, got ${text.slice(0, 80)}` } };
          break;
        }
      }
      return { ok: true, actionType: action.type, durationMs: Date.now() - started, data };
    } catch (e) {
      const code = e instanceof Error && /timeout/i.test(e.message) ? 'QUIESCENCE_TIMEOUT' : 'LOCATOR_NOT_FOUND';
      return { ok: false, actionType: action.type, durationMs: Date.now() - started, error: { code, message: e instanceof Error ? e.message : String(e) } };
    } finally {
      this.inFlight = false;
    }
  }

  async validate(expected: BoundExpectedAfterAction): Promise<AssertionResult> {
    const started = Date.now();
    try {
      if (expected.type === 'field_value_contains') {
        const actual = await this.locator(expected.target.locator).inputValue();
        return { ok: actual.includes(expected.value), type: expected.type, expected: expected.value, actual, durationMs: Date.now() - started };
      }
      if (expected.type === 'text_visible') {
        const ok = await this.mustPage().getByText(expected.text).first().isVisible();
        return { ok, type: expected.type, expected: expected.text, durationMs: Date.now() - started };
      }
      if (expected.type === 'element_visible') {
        const ok = expected.target ? await this.locator(expected.target.locator).isVisible() : await this.mustPage().getByText(expected.text!).first().isVisible();
        return { ok, type: expected.type, expected: expected.text, durationMs: Date.now() - started };
      }
      if (expected.type === 'url_contains') {
        const actual = this.mustPage().url();
        return { ok: actual.includes(expected.value), type: expected.type, expected: expected.value, actual, durationMs: Date.now() - started };
      }
      if (expected.type === 'no_console_errors') {
        const errors = this.signals.console.filter((c) => c.level === 'error' && c.isAppOrigin && !this.isKnownConsoleNoise(c.text));
        return { ok: errors.length === 0, type: expected.type, durationMs: Date.now() - started, actual: errors.length ? errors.map((e) => e.text).join(' | ').slice(0, 200) : undefined };
      }
      return { ok: true, type: (expected as { type: string }).type, durationMs: Date.now() - started };
    } catch (e) {
      return { ok: false, type: expected.type, actual: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started };
    }
  }

  async runtimeState(observation: ScreenObservation, conditions: PlanCondition[]): Promise<RuntimeStateSnapshot> {
    const page = this.mustPage();
    const attributeConditions = conditions.filter((c): c is Extract<PlanCondition, { type: 'attribute_state' }> => c.type === 'attribute_state');
    const storageConditions = conditions.filter((c): c is Extract<PlanCondition, { type: 'storage_state' }> => c.type === 'storage_state');
    const attributes: Record<string, unknown> = {};
    for (const condition of attributeConditions) {
      const key = `${JSON.stringify(condition.target)}::${condition.attribute}`;
      try {
        attributes[key] = condition.target.strategy === 'document'
          ? await page.evaluate((attr) => document.documentElement.getAttribute(attr) ?? document.body?.getAttribute(attr), condition.attribute)
          : await this.locator(condition.target).first().getAttribute(condition.attribute);
      } catch (error) {
        attributes[key] = error instanceof Error ? error.message : String(error);
      }
    }
    const storage = await page.evaluate((items) => {
      const out: Record<string, unknown> = {};
      for (const item of items) {
        const area = item.storage === 'localStorage' ? window.localStorage : window.sessionStorage;
        out[`${item.storage}:${item.key}`] = area.getItem(item.key);
      }
      return out;
    }, storageConditions.map((c) => ({ storage: c.storage, key: c.key }))).catch(() => ({}));
    const domState = await page.evaluate(() => ({
      htmlClass: document.documentElement.className,
      bodyClass: document.body?.className ?? '',
      htmlTheme: document.documentElement.getAttribute('data-theme') ?? document.documentElement.getAttribute('data-color-mode'),
      bodyTheme: document.body?.getAttribute('data-theme') ?? document.body?.getAttribute('data-color-mode'),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      backgroundColor: getComputedStyle(document.body ?? document.documentElement).backgroundColor,
      localTheme: window.localStorage.getItem('theme') ?? window.localStorage.getItem('color-theme') ?? window.localStorage.getItem('appearance'),
      sessionTheme: window.sessionStorage.getItem('theme') ?? window.sessionStorage.getItem('color-theme') ?? window.sessionStorage.getItem('appearance'),
    })).catch(() => ({}));
    return {
      observationId: observation.observationId,
      url: observation.url,
      semanticStates: this.semanticStates(observation, domState),
      attributes,
      storage,
      timestamp: new Date().toISOString(),
    };
  }

  async waitForQuiescence(timeoutMs: number): Promise<QuiescenceResult> {
    const page = this.mustPage();
    if (page.isClosed()) return { stable: false, reason: 'TIMEOUT_BUT_CONTINUABLE', elapsedMs: 0 };
    return this.quiescence.wait(page, timeoutMs);
  }

  async screenshot(): Promise<Buffer | undefined> {
    if (!this.page || this.page.isClosed()) return undefined;
    return this.page.screenshot({ fullPage: true }).catch(() => undefined);
  }

  async domSnapshot(): Promise<string | undefined> {
    if (!this.page || this.page.isClosed()) return undefined;
    return this.page.content().catch(() => undefined);
  }

  consoleLog(): string {
    return this.signals.console.map((c) => `[${c.timestamp}] ${c.level.toUpperCase()} ${c.text}`).join('\n');
  }

  networkLog(): unknown[] {
    return this.signals.network;
  }

  async saveTrace(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
    await this.context?.tracing.stop({ path }).catch(() => undefined);
  }

  async saveVideo(path: string): Promise<void> {
    const video = this.page?.video();
    await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await video?.saveAs(path).catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.page = undefined;
    this.config = undefined;
  }

  private byId(id: string): Locator {
    const locator = this.locators.get(id);
    if (!locator) throw new Error(`Locator not found for ${id}`);
    return this.locator(locator);
  }

  private locator(desc: LocatorDescriptor): Locator {
    const p = this.mustPage();
    if (desc.strategy === 'semantic') {
      return desc.candidates
        .map((candidate) => this.locator(candidate))
        .reduce((combined, candidate) => combined.or(candidate))
        .first();
    }
    if (desc.strategy === 'index') return this.locator(desc.target).nth(desc.index);
    if (desc.strategy === 'text_any') return p.getByText(new RegExp(desc.texts.map((t) => this.escapeRegExp(t)).join('|'), desc.exact ? undefined : 'i')).first();
    if (desc.strategy === 'document') return p.locator('html');
    if (desc.strategy === 'label') return p.getByLabel(desc.text, { exact: desc.exact });
    if (desc.strategy === 'placeholder') return p.getByPlaceholder(desc.text, { exact: desc.exact });
    if (desc.strategy === 'text') return p.getByText(desc.text, { exact: desc.exact });
    if (desc.strategy === 'testid') return p.getByTestId(desc.value);
    return p.getByRole(desc.role as Parameters<Page['getByRole']>[0], { name: desc.name, exact: desc.exact });
  }

  private semanticStates(observation: ScreenObservation, domState: Record<string, unknown> = {}): Record<string, unknown> {
    const text = [...observation.visibleTexts, ...observation.elements.flatMap((e) => [e.name, e.text ?? '', String(e.checked ?? ''), String(e.expanded ?? '')])].join(' | ');
    const loginRoute = /\/(login|signin|sign-in|auth)\b/i.test(observation.url);
    const loginFormText = /\b(entrar|login|senha|password|sign in|acessar)\b/i.test(text) && /\b(senha|password)\b/i.test(text);
    const interactiveSurface = observation.elements.some((element) =>
      element.inViewport && ['button', 'link', 'textbox', 'searchbox', 'combobox', 'menuitem'].includes(element.role),
    );
    return {
      url: observation.url,
      auth: loginRoute || (loginFormText && !interactiveSurface) ? 'anonymous' : 'authenticated',
      menuOpen: observation.elements.some((element) => element.inViewport && (element.expanded === true || element.role === 'menuitem')),
      appearance_mode: JSON.stringify(domState),
      visibleTextSignature: text.slice(0, 800),
    };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async compareScreenshot(baselinePath: string, threshold = 0.01): Promise<{ ok: boolean; diffRatio: number; baselineCreated?: boolean }> {
    let actual = await this.screenshot();
    if (!actual) return { ok: false, diffRatio: 1 };
    await mkdir(dirname(baselinePath), { recursive: true });
    const baseline = await readFile(baselinePath).catch(() => undefined);
    if (!baseline) {
      await this.waitForQuiescence(this.config?.timeouts.quiescenceMs ?? 3000).catch(() => undefined);
      actual = await this.screenshot();
      if (!actual) return { ok: false, diffRatio: 1 };
      await writeFile(baselinePath, actual);
      return { ok: true, diffRatio: 0, baselineCreated: true };
    }
    const expectedPng = PNG.sync.read(baseline);
    const actualPng = PNG.sync.read(actual);
    if (expectedPng.width !== actualPng.width || expectedPng.height !== actualPng.height) return { ok: false, diffRatio: 1 };
    const changed = pixelmatch(expectedPng.data, actualPng.data, undefined, actualPng.width, actualPng.height, { threshold: 0.1 });
    const diffRatio = changed / (actualPng.width * actualPng.height);
    return { ok: diffRatio <= threshold, diffRatio };
  }

  async auditAccessibility(): Promise<Array<{ id: string; impact?: string | null; description: string; nodes: number }>> {
    const results = await new AxeBuilder({ page: this.mustPage() }).analyze();
    return results.violations.map((violation: { id: string; impact?: string | null; description: string; nodes: unknown[] }) => ({ id: violation.id, impact: violation.impact, description: violation.description, nodes: violation.nodes.length }));
  }

  private isKnownConsoleNoise(text: string): boolean {
    return (this.config?.classifier.knownNoiseRegexes ?? []).some((pattern) => {
      try {
        return new RegExp(pattern, 'i').test(text);
      } catch {
        return false;
      }
    });
  }

  private mustPage(): Page {
    if (!this.page) throw new HarnessFatalError('Browser not opened');
    return this.page;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed() && (await this.isPageUsable(this.page))) return this.page;
    const config = this.config;
    if (!config) throw new HarnessFatalError('Browser not opened');
    if (!this.browser?.isConnected()) throw new HarnessFatalError('Browser is closed');
    await this.recoverPage(config);
    return this.mustPage();
  }

  private async recoverPage(config: RunConfig): Promise<void> {
    this.page = undefined;
    try {
      this.page = await this.context?.newPage();
      this.registerDialogHandler();
    } catch {
      this.context = undefined;
    }
    if (!this.page) {
      await this.createContextAndPage(config);
    } else {
      this.signalsCollector.attach(this.page, config, this.signals);
    }
    this.mustPage();
    await this.navigateWithRetry(config.baseUrl).catch(() => undefined);
  }

  private async createContextAndPage(config: RunConfig): Promise<void> {
    if (!this.browser?.isConnected()) throw new HarnessFatalError('Browser is closed');
    this.context = await this.browser.newContext({
      viewport: config.browser.viewport,
      locale: config.browser.locale,
      timezoneId: config.browser.timezone,
      storageState: config.auth.kind === 'storageState' ? config.auth.path : undefined,
      recordVideo: { dir: this.videoDir },
    });
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true }).catch(() => undefined);
    this.page = await this.context.newPage();
    this.signals.reset();
    this.signalsCollector.attach(this.page, config, this.signals);
    this.registerDialogHandler();
  }

  private registerDialogHandler(): void {
    if (!this.page) return;
    this.pendingDialog = undefined;
    this.page.on('dialog', (dialog) => {
      this.pendingDialog = dialog;
    });
  }

  private async navigateWithRetry(url: string): Promise<void> {
    const retry = this.config?.timeouts.navigationRetry ?? { maxAttempts: 1, backoffMs: 250 };
    let lastError: unknown;
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      try {
        await this.mustPage().goto(url, { timeout: this.config?.timeouts.navigationMs });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < retry.maxAttempts) await this.mustPage().waitForTimeout(retry.backoffMs * attempt);
      }
    }
    throw lastError;
  }

  private async fillRichText(target: Locator, value: string): Promise<void> {
    if (await target.getAttribute('contenteditable') === 'true') {
      await target.evaluate((el, v) => {
        el.textContent = '';
        el.focus();
        document.execCommand('insertText', false, v);
      }, value);
      return;
    }
    await target.fill(value);
  }

  private async clickAllowingPendingDialog(target: Locator): Promise<void> {
    try {
      await target.click({ timeout: this.config?.timeouts.actionMs ?? 15000 });
    } catch (error) {
      if (!this.pendingDialog) throw error;
    }
  }

  private async isPageUsable(page: Page): Promise<boolean> {
    return page.evaluate(() => true).then(() => true).catch(() => false);
  }

  private async stableObservation(page: Page): Promise<ScreenObservation> {
    const config = this.config;
    if (config) await this.quiescence.wait(page, config.timeouts.quiescenceMs).catch(() => undefined);
    let obs = await this.observation.observe(page, this.signals, { includeScreenshot: this.config?.runtime.observation?.includeScreenshot ?? false });
    const maxRetries = config ? 2 : 0;
    for (let i = 0; i < maxRetries && obs.pageState.isLoading; i++) {
      await page.waitForTimeout(Math.min(1000, Math.floor(config!.timeouts.quiescenceMs / 2))).catch(() => undefined);
      await this.quiescence.wait(page, config!.timeouts.quiescenceMs).catch(() => undefined);
      obs = await this.observation.observe(page, this.signals, { includeScreenshot: this.config?.runtime.observation?.includeScreenshot ?? false });
    }
    return obs;
  }

  private playwrightMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/Target page, context or browser has been closed/i.test(message)) return 'Target page, context or browser has been closed';
    return message;
  }
}
