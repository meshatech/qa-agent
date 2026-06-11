import { Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { ToolExecutorPort } from '../ports/tool-executor.port.js';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { ToolResult } from '../../domain/schemas/tool-result.schema.js';
import type {
  NavigatorOpenParamsSchema,
  ObserverCaptureParamsSchema,
  ActorClickParamsSchema,
  ActorFillParamsSchema,
  ActorTypeParamsSchema,
  ActorPressParamsSchema,
  ValidatorStateParamsSchema,
  ExplorerScanParamsSchema,
} from '../../domain/schemas/tool-queue.schema.js';
import type { z } from 'zod';

type NavigatorOpenParams = z.infer<typeof NavigatorOpenParamsSchema>;
type ObserverCaptureParams = z.infer<typeof ObserverCaptureParamsSchema>;
type ActorClickParams = z.infer<typeof ActorClickParamsSchema>;
type ActorFillParams = z.infer<typeof ActorFillParamsSchema>;
type ActorTypeParams = z.infer<typeof ActorTypeParamsSchema>;
type ActorPressParams = z.infer<typeof ActorPressParamsSchema>;
type ValidatorStateParams = z.infer<typeof ValidatorStateParamsSchema>;
type ExplorerScanParams = z.infer<typeof ExplorerScanParamsSchema>;

export class ToolExecutorService implements ToolExecutorPort {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(
    @Inject('BrowserHarnessPort')
    private readonly browser: BrowserHarnessPort,
  ) {}

  async navigatorOpen(params: NavigatorOpenParams): Promise<ToolResult> {
    const started = Date.now();
    try {
      await this.browser.execute({ type: 'navigate', to: params.url, reason: `Open ${params.url}` });
      return { ok: true, tool: 'navigator.open', durationMs: Date.now() - started, data: { url: params.url } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`navigatorOpen failed: ${msg}`);
      return { ok: false, tool: 'navigator.open', durationMs: Date.now() - started, error: { code: 'NAVIGATION_FAILED', message: msg } };
    }
  }

  async observerCapture(_params: ObserverCaptureParams): Promise<ToolResult> {
    const started = Date.now();
    try {
      const obs = await this.browser.observe();
      return {
        ok: true,
        tool: 'observer.capture',
        durationMs: Date.now() - started,
        data: {
          observationId: obs.observationId,
          url: obs.url,
          title: obs.title,
          elementCount: obs.elements.length,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`observerCapture failed: ${msg}`);
      return { ok: false, tool: 'observer.capture', durationMs: Date.now() - started, error: { code: 'OBSERVATION_FAILED', message: msg } };
    }
  }

  async actorClick(_params: ActorClickParams): Promise<ToolResult> {
    const started = Date.now();
    try {
      await this.browser.execute({ type: 'click', targetElementId: 'el_000', reason: 'Click target element' });
      return { ok: true, tool: 'actor.click', durationMs: Date.now() - started };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`actorClick failed: ${msg}`);
      return { ok: false, tool: 'actor.click', durationMs: Date.now() - started, error: { code: 'CLICK_FAILED', message: msg } };
    }
  }

  async actorFill(params: ActorFillParams): Promise<ToolResult> {
    const started = Date.now();
    try {
      await this.browser.execute({ type: 'fill', targetElementId: 'el_000', value: params.value, reason: `Fill field with "${params.value}"` });
      return { ok: true, tool: 'actor.fill', durationMs: Date.now() - started };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`actorFill failed: ${msg}`);
      return { ok: false, tool: 'actor.fill', durationMs: Date.now() - started, error: { code: 'FILL_FAILED', message: msg } };
    }
  }

  async actorType(params: ActorTypeParams): Promise<ToolResult> {
    const started = Date.now();
    try {
      await this.browser.execute({ type: 'press', key: 'Enter', reason: `Type text: ${params.text}` });
      return { ok: true, tool: 'actor.type', durationMs: Date.now() - started };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`actorType failed: ${msg}`);
      return { ok: false, tool: 'actor.type', durationMs: Date.now() - started, error: { code: 'TYPE_FAILED', message: msg } };
    }
  }

  async actorPress(params: ActorPressParams): Promise<ToolResult> {
    const started = Date.now();
    try {
      await this.browser.execute({ type: 'press', key: params.key, reason: `Press key: ${params.key}` });
      return { ok: true, tool: 'actor.press', durationMs: Date.now() - started };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`actorPress failed: ${msg}`);
      return { ok: false, tool: 'actor.press', durationMs: Date.now() - started, error: { code: 'PRESS_FAILED', message: msg } };
    }
  }

  async validatorState(params: ValidatorStateParams): Promise<ToolResult> {
    const started = Date.now();
    try {
      const result = await this.browser.validate({
        type: params.condition.type as 'field_value_contains',
        target: { originalElementId: 'el_000', observationId: 'obs-000', locator: { strategy: 'document' } },
        value: '',
      });
      return {
        ok: result.ok,
        tool: 'validator.state',
        durationMs: Date.now() - started,
        data: { condition: params.condition, actual: result.actual },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`validatorState failed: ${msg}`);
      return { ok: false, tool: 'validator.state', durationMs: Date.now() - started, error: { code: 'VALIDATION_FAILED', message: msg } };
    }
  }

  async explorerScan(params: ExplorerScanParams): Promise<ToolResult> {
    const started = Date.now();
    try {
      const obs = await this.browser.observe();
      let findings: unknown[] = [];
      switch (params.mode) {
        case 'scan_clickables':
          findings = obs.elements.filter((e) => ['button', 'link', 'menuitem'].includes(e.role));
          break;
        case 'scan_inputs':
          findings = obs.elements.filter((e) => ['textbox', 'combobox', 'searchbox'].includes(e.role) || e.tagName === 'textarea' || e.editable);
          break;
        case 'scan_accessibility_tree':
          findings = obs.elements.filter((e) => e.source === 'ax');
          break;
        case 'scan_semantic_candidates':
          findings = obs.elements.filter((e) => e.locator.strategy === 'semantic');
          break;
        case 'full_observation':
        default:
          findings = obs.elements;
      }
      return {
        ok: true,
        tool: 'explorer.scan',
        durationMs: Date.now() - started,
        data: { mode: params.mode, findingsCount: findings.length, findings: findings.slice(0, 20) },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`explorerScan failed: ${msg}`);
      return { ok: false, tool: 'explorer.scan', durationMs: Date.now() - started, error: { code: 'SCAN_FAILED', message: msg } };
    }
  }
}
