import { Inject, Injectable } from '@nestjs/common';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { AttemptRecord, BugClassification, BugSignalType, QaBug, QaStep } from '../../domain/models/run.model.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { SanitizerService } from './sanitizer.service.js';
import { ReportRenderer } from '../../infra/persistence/report-renderer.js';

export interface RecordEvidenceInput {
  bugId: string;
  step: QaStep;
  observation?: ScreenObservation;
  classification: BugClassification;
  config: RunConfig;
  scenarioId?: string;
  taskId?: string;
  attempts?: AttemptRecord[];
  signalType?: BugSignalType;
  rawMessage?: string;
  url?: string;
  expected?: string;
  actual?: string;
  runId?: string;
}

@Injectable()
export class EvidenceService {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort,
    @Inject(SanitizerService) private readonly sanitizer: SanitizerService,
    @Inject(ReportRenderer) private readonly renderer: ReportRenderer,
  ) {}

  async record(runDir: string, input: RecordEvidenceInput): Promise<QaBug> {
    const bugDir = `bugs/${input.bugId}`;
    const capturedAt = new Date().toISOString();
    await this.repo.ensureDir(runDir, bugDir);

    const screenshot = await this.browser.screenshot().catch(() => undefined);
    const dom = await this.browser.domSnapshot().catch(() => undefined);
    const consoleLog = this.browser.consoleLog?.() ?? '';
    const networkLog = this.browser.networkLog();

    if (screenshot) await this.repo.writeFile(runDir, `${bugDir}/screenshot.png`, screenshot);
    if (dom) await this.repo.writeFile(runDir, `${bugDir}/dom-snapshot.html`, this.sanitizer.sanitize(this.purifyDomEvidence(dom)));
    await this.repo.writeFile(runDir, `${bugDir}/console.log`, this.sanitizer.sanitize(consoleLog));
    await this.repo.writeJson(runDir, `${bugDir}/network.json`, this.sanitizer.sanitize(networkLog));
    await this.repo.writeJson(runDir, `${bugDir}/observation.json`, this.sanitizer.sanitize(input.observation ?? {}));

    const bug: QaBug = {
      bugId: input.bugId,
      stepId: input.step.stepId,
      scenarioId: input.scenarioId,
      taskId: input.taskId,
      classification: input.classification,
      path: bugDir,
      url: input.url,
      expected: input.expected,
      actual: input.actual,
      signalType: input.signalType,
      rawMessage: input.rawMessage,
      capturedAt,
    };

    await this.repo.writeJson(runDir, `${bugDir}/bug.json`, this.sanitizer.sanitize({ schemaVersion: 'bug.v1', ...bug }));
    const reportMd = this.renderer.renderBugReport({
      bug,
      step: input.step,
      config: input.config,
      attempts: input.attempts,
      consoleLogs: consoleLog,
      runId: input.runId,
      promptVersion: input.config.llm.promptVersion,
      agentVersion: input.config.agentVersion,
    });
    await this.repo.writeFile(runDir, `${bugDir}/bug-report.md`, this.sanitizer.sanitize(reportMd));
    await this.browser.saveTrace(`${runDir}/${bugDir}/trace.zip`).catch(() => undefined);
    await this.browser.saveVideo(`${runDir}/${bugDir}/video.webm`).catch(() => undefined);

    return bug;
  }

  private purifyDomEvidence(html: string): string {
    return html
      .replace(/<input([^>]*type=["']password["'][^>]*)value=["'][^"']*["']/gi, '<input$1value="***"')
      .replace(/<meta([^>]*name=["']csrf-token["'][^>]*)content=["'][^"']*["']/gi, '<meta$1content="***"');
  }
}
