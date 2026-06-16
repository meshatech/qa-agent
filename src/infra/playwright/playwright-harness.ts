import { Inject, Injectable, Logger } from '@nestjs/common';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page, type Locator, type BrowserType } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  private readonly logger = new Logger(PlaywrightHarness.name);
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private config?: RunConfig;
  private inFlight = false;
  private recovering = false;
  private signals: SignalsBuffer;
  private readonly locators = new Map<string, LocatorDescriptor>();
  private readonly videoDir = join(tmpdir(), `qa-agent-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  private pendingDialog?: { accept(promptText?: string): Promise<void>; dismiss(): Promise<void>; message(): string };
  private tabTraceSeq = 0;

  constructor(
    @Inject(PlaywrightQuiescenceGuard) private readonly quiescence: PlaywrightQuiescenceGuard,
    @Inject(ObservationService) private readonly observation: ObservationService,
    @Inject(SignalsCollector) private readonly signalsCollector: SignalsCollector,
    @Inject(FormLoginService) private readonly formLogin: FormLoginService,
  ) {
    this.signals = this.signalsCollector.createBuffer();
  }

  private isContainerEnvironment(): boolean {
    // Explicit opt-in via env wins (set in Dockerfile / docker-compose). This is
    // the only reliable signal across cgroup v1/v2 and rootless runtimes.
    const flag = process.env.QA_AGENT_CONTAINER ?? process.env.QA_AGENT_NO_SANDBOX;
    if (flag !== undefined) return flag === '1' || flag.toLowerCase() === 'true';
    // Standard Docker marker file.
    if (existsSync('/.dockerenv')) return true;
    // Heuristic fallback. cgroup v1 lines contain "docker"; cgroup v2 collapses to
    // "0::/" so we also look for other container runtime hints.
    try {
      return /\b(docker|containerd|kubepods|libpod|podman)\b/.test(readFileSync('/proc/self/cgroup', 'utf8'));
    } catch {
      return false;
    }
  }

  private chromiumLaunchArgs(): string[] | undefined {
    // Chromium refuses to start as root without --no-sandbox; containers run as
    // root by default, so disable the sandbox there.
    return this.isContainerEnvironment() ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : undefined;
  }

  async open(config: RunConfig): Promise<void> {
    try {
      this.config = config;
      const engine: BrowserType = config.browser.engine === 'firefox' ? firefox : config.browser.engine === 'webkit' ? webkit : chromium;
      const args = config.browser.engine === 'firefox' || config.browser.engine === 'webkit' ? undefined : this.chromiumLaunchArgs();
      this.browser = await engine.launch({ headless: !config.browser.headed, slowMo: config.browser.slowMoMs, args });
      await mkdir(this.videoDir, { recursive: true });
      this.logger.log('[TabTrace] browser.open starting (tab trace enabled)');
      await this.createContextAndPage(config, { withStorage: false });
      const page = this.mustPage();
      if (config.auth.kind === 'formLogin') await this.formLogin.login(page, config);
      await this.navigateWithRetry(config.baseUrl);
      if (config.auth.kind === 'ssoRedirect') {
        const storagePath = this.requireStorageStatePath(config);
        if (await this.needsSsoLogin(config)) {
          this.logger.log('[PlaywrightHarness] Session missing or expired, performing SSO redirect login...');
          const activePage = await this.performSsoRedirectLogin(this.mustPage(), config);
          this.page = activePage;
          this.signalsCollector.attach(activePage, config, this.signals);
          this.registerDialogHandler();
          await mkdir(dirname(storagePath), { recursive: true }).catch(() => undefined);
          await Promise.all([
            this.waitForAuthenticatedApp(config, activePage),
            this.persistEphemeralSession(storagePath),
          ]);
          if (await this.needsSsoLogin(config)) {
            throw new HarnessFatalError('SSO redirect login completed but application is still on login page');
          }
          this.logger.log('[PlaywrightHarness] SSO login successful, continuing on authenticated page');
        }
      }
      await this.waitForQuiescence(config.timeouts.quiescenceMs).catch(() => undefined);
    } catch (error) {
      if (error instanceof HarnessFatalError) throw error;
      throw new HarnessFatalError(error instanceof Error ? error.message : 'browser open failed', error);
    }
  }

  async captureAuth(config: RunConfig, outputPath: string): Promise<void> {
    try {
      const engine: BrowserType = config.browser.engine === 'firefox' ? firefox : config.browser.engine === 'webkit' ? webkit : chromium;
      const args = config.browser.engine === 'firefox' || config.browser.engine === 'webkit' ? undefined : this.chromiumLaunchArgs();
      this.browser = await engine.launch({ headless: !config.browser.headed, args });
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
    const actionLabel = this.describeAction(action);
    this.tabTrace('execute:before', { action: actionLabel });
    try {
      switch (action.type) {
        case 'fill': {
          let target: Locator;
          try {
            target = this.byId(action.targetElementId);
          } catch {
            target = await this.findLargestEditable();
          }
          try {
            await this.smartFill(target, action.value);
          } catch {
            // If original target fails, try largest editable as fallback
            target = await this.findLargestEditable();
            await this.smartFill(target, action.value);
          }
          break;
        }
        case 'click':
          await this.clickSameTab(this.byId(action.targetElementId), actionLabel);
          break;
        case 'press': {
          const target = action.targetElementId ? this.byId(action.targetElementId) : null;
          if (target) await target.press(action.key);
          else await this.mustPage().keyboard.press(action.key);
          break;
        }
        case 'typeText': {
          const target = action.targetElementId ? this.byId(action.targetElementId) : null;
          if (target) {
            await target.focus();
            await this.mustPage().keyboard.type(action.text, { delay: action.delayMs });
          } else {
            await this.mustPage().keyboard.type(action.text, { delay: action.delayMs });
          }
          break;
        }
        case 'clickOutside': {
          const page = this.mustPage();
          // In headed mode, avoid absolute screen coordinates that may hit the browser chrome (minimize/close buttons).
          // Instead, click at a safe position inside the page content area (bottom-right corner of viewport).
          const viewport = page.viewportSize();
          if (!viewport) {
            await page.keyboard.press('Escape');
          } else {
            // Click near bottom-right of page content, away from browser UI chrome
            await page.mouse.click(viewport.width - 20, viewport.height - 20);
          }
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
      if (this.config?.runtime.enforceSingleTab) await this.sweepGhostTabs('execute:finally');
      this.tabTrace('execute:after', { action: actionLabel });
      this.inFlight = false;
    }
  }

  async validate(expected: BoundExpectedAfterAction): Promise<AssertionResult> {
    const started = Date.now();
    try {
      if (expected.type === 'field_value_contains') {
        let actual: string;
        try {
          actual = await this.locator(expected.target.locator).inputValue();
        } catch {
          // Fallback: try largest editable element
          const fallback = await this.findLargestEditable();
          actual = await fallback.inputValue().catch(() => '');
        }
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
    // Clean up temp video directory so partial/intermediate recordings don't leak
    await rm(this.videoDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async close(): Promise<void> {
    const browserPid = (this.browser as { process?: () => { pid?: number } | undefined } | undefined)?.process?.()?.pid;
    try {
      await this.context?.close();
      this.logger.log('[PlaywrightHarness.close] context closed');
    } catch (err) {
      this.logger.error(`[PlaywrightHarness.close] context.close failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await this.browser?.close();
      this.logger.log('[PlaywrightHarness.close] browser closed');
    } catch (err) {
      this.logger.error(`[PlaywrightHarness.close] browser.close failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Fallback: kill process if still alive (headed chromium sometimes survives .close())
    if (browserPid) {
      try {
        process.kill(browserPid, 0); // check if alive
        this.logger.error(`[PlaywrightHarness.close] Browser process ${browserPid} still alive after close(), sending SIGKILL`);
        process.kill(browserPid, 'SIGKILL');
      } catch {
        // process already dead, ok
      }
    }
    // Clean up temp video directory
    await rm(this.videoDir, { recursive: true, force: true }).catch(() => undefined);
    this.browser = undefined;
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
    if (this.page && !this.page.isClosed()) {
      if (await this.isPageUsable(this.page)) return this.page;
      await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => undefined);
      if (await this.isPageUsable(this.page)) return this.page;
    }
    const config = this.config;
    if (!config) throw new HarnessFatalError('Browser not opened');
    if (!this.browser?.isConnected()) throw new HarnessFatalError('Browser is closed');
    if (this.recovering) {
      await this.waitWhileRecovering();
      if (this.page && !this.page.isClosed() && (await this.isPageUsable(this.page))) return this.page;
    }
    this.tabTrace('ensurePage:recovering', { primaryUrl: this.page?.isClosed() === false ? this.page.url() : '(none)' });
    await this.recoverPage(config);
    return this.mustPage();
  }

  private async recoverPage(config: RunConfig): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    this.tabTrace('recoverPage:start', { baseUrl: config.baseUrl });
    try {
      const pages = this.context?.pages().filter((candidate) => !candidate.isClosed()) ?? [];
      const primary = this.page && !this.page.isClosed() ? this.page : pages[0];
      if (primary) {
        this.page = primary;
        this.tabTrace('recoverPage:reuse-primary', { url: primary.url() });
        await this.closeExtraPages(primary, 'recoverPage');
        this.registerDialogHandler();
        this.signalsCollector.attach(this.page, config, this.signals);
        if (!(await this.isPageUsable(this.page))) {
          await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => undefined);
        }
        await this.navigateWithRetry(config.baseUrl).catch(() => undefined);
      } else {
        this.tabTrace('recoverPage:create-context', {});
        await this.createContextAndPage(config);
        await this.navigateWithRetry(config.baseUrl).catch(() => undefined);
      }
      this.mustPage();
    } finally {
      this.recovering = false;
      this.tabTrace('recoverPage:done', {});
    }
  }

  private async waitWhileRecovering(): Promise<void> {
    for (let i = 0; i < 50 && this.recovering; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async createContextAndPage(config: RunConfig, options?: { withStorage?: boolean }): Promise<void> {
    if (!this.browser?.isConnected()) throw new HarnessFatalError('Browser is closed');
    this.tabTrace('createContextAndPage:start', { withStorage: options?.withStorage ?? true });
    const oldContext = this.context;
    this.context = undefined;
    await oldContext?.close().catch(() => undefined);
    const storageState = await this.resolveStorageStateForContext(config, options?.withStorage);
    this.context = await this.browser.newContext({
      viewport: config.browser.viewport,
      locale: config.browser.locale,
      timezoneId: config.browser.timezone,
      storageState,
      recordVideo: { dir: this.videoDir },
    });
    this.attachTabTraceListener(this.context);
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true }).catch(() => undefined);
    this.page = await this.context.newPage();
    this.attachSingleTabPolicy(this.context);
    if (config.runtime.enforceSingleTab) this.attachGhostTabKiller(this.context);
    this.signals.reset();
    this.signalsCollector.attach(this.page, config, this.signals);
    this.registerDialogHandler();
    this.tabTrace('createContextAndPage:done', { primaryUrl: this.page.url() });
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
    this.tabTrace('navigate:start', { url });
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      try {
        await this.mustPage().goto(url, { timeout: this.config?.timeouts.navigationMs });
        this.tabTrace('navigate:done', { url, attempt });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < retry.maxAttempts) await this.mustPage().waitForTimeout(retry.backoffMs * attempt);
      }
    }
    throw lastError;
  }

  private isAppUrl(url: string, config: RunConfig): boolean {
    if (!url || url === 'about:blank') return false;
    try {
      const host = new URL(url).hostname;
      return config.appDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  private requireStorageStatePath(config: RunConfig): string {
    if (config.auth.kind !== 'ssoRedirect' || !config.auth.storageStatePath) {
      throw new HarnessFatalError('ssoRedirect auth requires a runtime storageStatePath (set by RunAgentUseCase)');
    }
    return config.auth.storageStatePath;
  }

  private async resolveStorageStateForContext(config: RunConfig, withStorage?: boolean): Promise<string | undefined> {
    if (withStorage === false) return undefined;
    if (config.auth.kind === 'storageState') return config.auth.path;
    if (config.auth.kind !== 'ssoRedirect') return undefined;
    const path = config.auth.storageStatePath;
    if (!path) return undefined;
    const exists = await readFile(path).then(() => true).catch(() => false);
    if (!exists) {
      if (withStorage === true) {
        throw new HarnessFatalError(`Expected ephemeral storage state at ${path} after SSO login`);
      }
      return undefined;
    }
    return path;
  }

  private async needsSsoLogin(config: RunConfig): Promise<boolean> {
    if (config.auth.kind !== 'ssoRedirect') return false;
    const page = this.mustPage();
    try {
      if (/\/login\b/i.test(new URL(page.url()).pathname)) return true;
    } catch {
      return true;
    }
    if (config.auth.kind !== 'ssoRedirect') return false;
    try {
      return await this.toPlaywrightLocator(page, config.auth.loginButtonSelector).isVisible({ timeout: 1500 });
    } catch {
      return false;
    }
  }

  private async performSsoRedirectLogin(page: Page, config: RunConfig): Promise<Page> {
    const auth = config.auth as {
      loginUrl?: string;
      loginButtonSelector: LocatorDescriptor;
      idpUsernameSelector?: LocatorDescriptor;
      idpPasswordSelector?: LocatorDescriptor;
      idpSubmitSelector?: LocatorDescriptor;
      usernameEnv?: string;
      passwordEnv?: string;
      successWhen?: { urlContains?: string; textVisible?: string };
    };
    const username = auth.usernameEnv ? process.env[auth.usernameEnv] : undefined;
    const password = auth.passwordEnv ? process.env[auth.passwordEnv] : undefined;

    const loginUrl = new URL(auth.loginUrl ?? '/login', config.baseUrl).toString();
    this.logger.log(`[PlaywrightHarness] Navigating to login URL: ${loginUrl}`);
    await page.goto(loginUrl, { timeout: config.timeouts.navigationMs });
    await this.waitForQuiescence(config.timeouts.quiescenceMs).catch(() => undefined);

    this.logger.log(`[PlaywrightHarness] Clicking login button...`);
    const loginButton = this.toPlaywrightLocator(page, auth.loginButtonSelector);
    await this.clickSameTab(loginButton, 'sso:login-button');
    await page.waitForURL(/login\.mesha\.com\.br|meshamail\.mesha\.com\.br/i, { timeout: config.timeouts.navigationMs }).catch(() => undefined);
    await this.closeExtraPages(page, 'sso:after-login-button');
    const urlAfterClick = page.url();
    this.logger.log(`[PlaywrightHarness] URL after login button click: ${urlAfterClick}`);

    if (auth.idpUsernameSelector && auth.idpPasswordSelector && auth.idpSubmitSelector) {
      if (!username) throw new HarnessFatalError(`Missing env ${auth.usernameEnv} for ssoRedirect`);
      if (!password) throw new HarnessFatalError(`Missing env ${auth.passwordEnv} for ssoRedirect`);

      this.logger.log(`[PlaywrightHarness] Filling IDP credentials... username=${username.split('@')[0]}...@...`);
      const usernameLocator = this.toPlaywrightLocator(page, auth.idpUsernameSelector);
      const passwordLocator = this.toPlaywrightLocator(page, auth.idpPasswordSelector);
      const submitLocator = this.toPlaywrightLocator(page, auth.idpSubmitSelector);

      await usernameLocator.waitFor({ state: 'visible', timeout: config.timeouts.actionMs });
      await usernameLocator.fill(username);
      await passwordLocator.waitFor({ state: 'visible', timeout: config.timeouts.actionMs });
      await passwordLocator.fill(password);

    this.logger.log(`[PlaywrightHarness] Submitting IDP credentials...`);
      const urlBefore = page.url();
      const redirectWait = this.waitForAuthenticatedApp(config, page);
      this.tabTrace('sso:idp-submit:before', { url: urlBefore });
      await this.clickSameTab(submitLocator, 'sso:idp-submit');
      await redirectWait;

      const urlAfter = page.url();
    this.logger.log(`[PlaywrightHarness] URL after IDP submit: ${urlAfter}`);
      if (urlAfter === urlBefore) {
        throw new HarnessFatalError(`SSO redirect login failed: URL did not change after submit (still ${urlAfter})`);
      }

      // Check for auth failure messages on the page
      const pageText = await page.locator('body').innerText().catch(() => '');
      if (pageText.includes('Falha na autenticação') || pageText.includes('login.fail.message') || pageText.includes('Authentication failed')) {
        this.logger.error(`[PlaywrightHarness] IDP auth failure detected on page`);
      }

      if (auth.successWhen?.urlContains && !urlAfter.includes(auth.successWhen.urlContains)) {
        throw new HarnessFatalError(`SSO redirect login failed: expected URL to contain "${auth.successWhen.urlContains}", got ${urlAfter}`);
      }
      if (auth.successWhen?.textVisible) {
        await page.getByText(auth.successWhen.textVisible).first().waitFor({ state: 'visible', timeout: config.timeouts.actionMs });
      }
    }

    await this.closeExtraPages(page, 'sso:complete');
    this.logger.log(`[PlaywrightHarness] SSO redirect login completed`);
    return page;
  }

  private attachSingleTabPolicy(context: import('playwright').BrowserContext): void {
    void context.addInitScript({
      content: `
(() => {
  const install = () => {
    if (window.__qaSingleTabInstalled) return;
    window.__qaSingleTabInstalled = true;
    // Intentional browser-side console.log — runs in page context, not Node.js
    console.log('[TabTrace:init] single-tab policy installed');
    const nativeOpen = window.open.bind(window);
    window.open = (url, target, features) => {
      console.log('[TabTrace:init] window.open', JSON.stringify({ url: url == null ? '' : String(url), target: target ?? '', features: features ?? '' }));
      if (url && (!target || target === '_blank')) {
        window.location.assign(String(url));
        return window;
      }
      return nativeOpen(url, target, features);
    };
    document.addEventListener('click', (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest('a[target="_blank"]') : null;
      if (!anchor || !anchor.href) return;
      console.log('[TabTrace:init] _blank anchor click', anchor.href);
      event.preventDefault();
      event.stopPropagation();
      anchor.target = '_self';
      window.location.assign(anchor.href);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
      `.trim(),
    });
  }

  private attachGhostTabKiller(context: BrowserContext): void {
    context.on('page', (page) => {
      const primary = this.page;
      if (!primary || page === primary || page.isClosed()) return;
      this.tabTrace('ghostTabKiller:closing', { url: page.url(), primaryUrl: primary.url() });
      void page.close().catch(() => undefined);
    });
  }

  private async sweepGhostTabs(source: string): Promise<void> {
    const primary = this.page;
    if (!primary || primary.isClosed()) return;
    const extras = primary.context().pages().filter((candidate) => !candidate.isClosed() && candidate !== primary);
    if (!extras.length) return;
    for (const candidate of extras) {
      this.tabTrace('sweepGhostTabs:closing', { source, url: candidate.url(), primaryUrl: primary.url() });
      await candidate.close().catch(() => undefined);
    }
  }

  private attachTabTraceListener(context: BrowserContext): void {
    context.on('page', (page) => {
      const primary = this.page;
      const isPrimary = page === primary;
      this.tabTrace('context.page:event', {
        isPrimary,
        url: page.url(),
        opener: '(n/a)',
        caller: this.tabCaller(5),
      });
      page.on('close', () => {
        this.tabTrace('page.close:event', {
          isPrimary: page === this.page,
          url: page.url(),
          caller: this.tabCaller(5),
        });
      });
    });
  }

  private async clickSameTab(target: Locator, actionLabel = 'click'): Promise<void> {
    const page = this.mustPage();
    const targetMeta = await target.evaluate(`(el) => {
      const clickable = el.closest('a,button,[role="button"],[role="menuitem"],[role="link"],[role="switch"]') || el;
      if (clickable.tagName === 'A') clickable.target = '_self';
      return {
        tag: clickable.tagName,
        role: clickable.getAttribute('role') || '',
        text: (clickable.innerText || clickable.textContent || '').trim().slice(0, 120),
        href: clickable.tagName === 'A' ? clickable.href : '',
        target: clickable.tagName === 'A' ? clickable.target : '',
      };
    }`).catch(() => ({ tag: '?', role: '', text: '', href: '', target: '' }));
    this.tabTrace('clickSameTab:before', { action: actionLabel, target: targetMeta, primaryUrl: page.url() });
    let popupHandler: ((popup: Page) => void) | undefined;
    const popupPromise = new Promise<void>((resolve) => {
      popupHandler = (popup: Page) => {
        if (popup === page || popup.isClosed()) {
          resolve();
          return;
        }
        this.tabTrace('clickSameTab:popup-detected', {
          action: actionLabel,
          popupUrl: popup.url(),
          primaryUrl: page.url(),
          caller: this.tabCaller(4),
        });
        void popup.close().then(() => {
          this.tabTrace('clickSameTab:popup-closed', { action: actionLabel, popupUrl: popup.url() });
          resolve();
        }).catch(() => resolve());
      };
      page.context().on('page', popupHandler);
    });
    const popupWindow = new Promise<void>((resolve) => setTimeout(resolve, 150));
    try {
      await this.clickAllowingPendingDialog(target);
      await Promise.race([popupPromise, popupWindow]);
    } finally {
      if (popupHandler) page.context().off('page', popupHandler);
    }
    await this.enforceSingleTab(page, actionLabel);
    this.tabTrace('clickSameTab:after', { action: actionLabel, primaryUrl: page.url() });
  }

  private async enforceSingleTab(primary: Page, source = 'enforceSingleTab'): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const beforeCount = primary.context().pages().filter((candidate) => !candidate.isClosed()).length;
      await this.closeExtraPages(primary, `${source}:attempt-${attempt + 1}`);
      const openCount = primary.context().pages().filter((candidate) => !candidate.isClosed()).length;
      if (openCount <= 1) {
        if (beforeCount > 1) this.tabTrace('enforceSingleTab:ok', { source, attempt: attempt + 1, beforeCount, openCount });
        return;
      }
      this.tabTrace('enforceSingleTab:retry', { source, attempt: attempt + 1, beforeCount, openCount });
      await primary.waitForTimeout(50);
    }
    this.tabTrace('enforceSingleTab:exhausted', { source });
  }

  private async closeExtraPages(primary: Page, source = 'closeExtraPages'): Promise<void> {
    const extras = primary.context().pages().filter((candidate) => !candidate.isClosed() && candidate !== primary);
    if (!extras.length) return;
    for (const candidate of extras) {
      this.tabTrace('closeExtraPages:closing', { source, url: candidate.url(), primaryUrl: primary.url() });
    }
    await Promise.all(extras.map((candidate) => candidate.close().catch(() => undefined)));
    this.tabTrace('closeExtraPages:done', { source, closedCount: extras.length });
  }

  private persistEphemeralSession(storagePath: string): Promise<void> {
    return this.context?.storageState({ path: storagePath }).then(() => {
      this.logger.log(`[PlaywrightHarness] Ephemeral session saved to ${storagePath}`);
    }) ?? Promise.resolve();
  }

  private async waitForAuthenticatedApp(config: RunConfig, page: Page): Promise<void> {
    await page.waitForURL((url) => {
      try {
        const pathname = new URL(url.toString()).pathname;
        return this.isAppUrl(url.toString(), config) && !/\/login\b/i.test(pathname);
      } catch {
        return false;
      }
    }, { timeout: config.timeouts.navigationMs }).catch(() => undefined);
    await this.waitForQuiescence(config.timeouts.quiescenceMs).catch(() => undefined);
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

  private async smartFill(target: Locator, value: string): Promise<void> {
    const page = this.mustPage();
    try {
      // Strategy 1: standard .fill() (works for input, textarea, contenteditable)
      await target.fill(value);
      return;
    } catch {
      // Strategy 2: Manus-style — focus element via JS then keyboard.type()
      // This handles CodeMirror, Ace, and other custom editors
      try {
        await target.evaluate((el) => {
          el.focus();
          (el as HTMLElement).click();
          // Dispatch focus event for frameworks that listen
          el.dispatchEvent(new Event('focus', { bubbles: true }));
        });
        await page.waitForTimeout(100);
        await page.keyboard.type(value);
        return;
      } catch {
        // Strategy 3: pure JS injection — set innerText/value directly
        try {
          await target.evaluate((el, v) => {
            const htmlEl = el as HTMLElement;
            if ((htmlEl as HTMLInputElement).value !== undefined) {
              (htmlEl as HTMLInputElement).value = v;
            } else {
              htmlEl.textContent = v;
            }
            htmlEl.dispatchEvent(new Event('input', { bubbles: true }));
            htmlEl.dispatchEvent(new Event('change', { bubbles: true }));
          }, value);
        } catch {
          // Last resort: page-level keyboard after page click
          await target.click({ force: true });
          await page.keyboard.type(value, { delay: 10 });
        }
      }
    }
  }

  private async findLargestEditable(): Promise<Locator> {
    const page = this.mustPage();
    // Try selectors for common editable elements: textarea, input, contenteditable, CodeMirror, Ace editor
    const selectors = [
      'textarea',
      'input:not([type="hidden"])',
      '[contenteditable="true"]',
      '.CodeMirror',
      '.ace_editor',
      '[class*="editor"]',
      '[role="textbox"]',
    ];
    let bestLocator: Locator | undefined;
    let bestArea = 0;
    for (const selector of selectors) {
      const locators = await page.locator(selector).all();
      for (const loc of locators) {
        const box = await loc.boundingBox().catch(() => null);
        if (!box || box.width <= 0 || box.height <= 0) continue;
        const area = box.width * box.height;
        if (area > bestArea) {
          bestArea = area;
          bestLocator = loc;
        }
      }
    }
    if (!bestLocator) {
      // Last resort: body
      bestLocator = page.locator('body');
    }
    return bestLocator;
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

  private toPlaywrightLocator(page: Page, descriptor: LocatorDescriptor | string): Locator {
    if (typeof descriptor === 'string') return page.locator(descriptor);
    if (descriptor.strategy === 'role') return page.getByRole(descriptor.role as Parameters<Page['getByRole']>[0], { name: descriptor.name, exact: descriptor.exact });
    if (descriptor.strategy === 'label') return page.getByLabel(descriptor.text, { exact: descriptor.exact });
    if (descriptor.strategy === 'placeholder') return page.getByPlaceholder(descriptor.text, { exact: descriptor.exact });
    if (descriptor.strategy === 'text') return page.getByText(descriptor.text, { exact: descriptor.exact });
    if (descriptor.strategy === 'text_any') return page.getByText(new RegExp(descriptor.texts.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), descriptor.exact ? undefined : 'i')).first();
    if (descriptor.strategy === 'semantic') return this.toPlaywrightLocator(page, descriptor.candidates[0]!);
    if (descriptor.strategy === 'index') return this.toPlaywrightLocator(page, descriptor.target).nth(descriptor.index);
    if (descriptor.strategy === 'document') return page.locator('html');
    return page.getByTestId(descriptor.value);
  }

  private playwrightMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/Target page, context or browser has been closed/i.test(message)) return 'Target page, context or browser has been closed';
    return message;
  }

  private describeAction(action: QaAction): string {
    const reason = 'reason' in action && action.reason ? ` reason="${action.reason}"` : '';
    if (action.type === 'click' && 'targetElementId' in action) return `click id=${action.targetElementId}${reason}`;
    if (action.type === 'navigate' && 'to' in action) return `navigate to=${action.to}${reason}`;
    if (action.type === 'press' && 'key' in action) return `press key=${action.key}${reason}`;
    return `${action.type}${reason}`;
  }

  private tabCaller(depth = 4): string {
    return new Error().stack?.split('\n').slice(2, 2 + depth).map((line) => line.trim()).join(' <- ') ?? '';
  }

  private tabSnapshot(): Array<{ index: number; isPrimary: boolean; closed: boolean; url: string }> {
    const primary = this.page;
    return (this.context?.pages() ?? []).map((candidate, index) => ({
      index,
      isPrimary: candidate === primary,
      closed: candidate.isClosed(),
      url: candidate.isClosed() ? '(closed)' : candidate.url(),
    }));
  }

  private tabTrace(event: string, details: Record<string, unknown>): void {
    this.tabTraceSeq += 1;
    const pages = this.tabSnapshot();
    this.logger.log(`[TabTrace #${this.tabTraceSeq}] ${event} openPages=${pages.length} ${JSON.stringify({ ...details, pages })}`);
  }
}
