import { Module } from '@nestjs/common';
import { FileConfigLoader } from './config/file-config.loader.js';
import { FilePreflightReportWriterAdapter } from './persistence/file-preflight-report-writer.adapter.js';
import { FileDemandContextWriterAdapter } from './persistence/file-demand-context-writer.adapter.js';
import { FilePrDiffContextWriterAdapter } from './persistence/file-pr-diff-context-writer.adapter.js';
import { FileCorrelationArtifactsWriterAdapter } from './persistence/file-correlation-artifacts-writer.adapter.js';
import { FetchClickUpApiAdapter } from './clickup/fetch-clickup-api.adapter.js';
import { ClickUpHttpReaderAdapter } from './clickup/clickup-http-reader.adapter.js';
import { FakeClickUpReaderAdapter } from './clickup/fake-clickup-reader.adapter.js';
import { FetchGitHubApiAdapter } from './github/fetch-github-api.adapter.js';
import { FileGitHubEventContextAdapter } from './github/file-github-event-context.adapter.js';
import { GitHubActionsPrContextReaderAdapter } from './github/github-actions-pr-context-reader.adapter.js';
import { ExecGitRepositoryAdapter } from './git/exec-git-repository.adapter.js';
import { DecisionRouterProvider } from './llm/decision-router.provider.js';
import { FakeDecisionProvider } from './llm/fake-decision.provider.js';
import { GroqDecisionProvider } from './llm/groq-decision.provider.js';
import { OpenAiLangChainDecisionProvider } from './llm/openai-langchain-decision.provider.js';
import { JsonObjectExtractor, LlmOutputSanitizer, LlmPlanPatchNormalizer, SafeJsonParser } from './llm/llm-output-normalizer.js';
import { ReportRenderer } from './persistence/report-renderer.js';
import { FileRunRepository } from './persistence/file-run.repository.js';
import { RunDirectoryManager } from './persistence/run-directory.manager.js';
import { PlaywrightHarness } from './playwright/playwright-harness.js';
import { PlaywrightQuiescenceGuard } from './playwright/playwright-quiescence.guard.js';
import { FormLoginService } from './playwright/auth/form-login.js';
import { ObservationService } from './observation/observation.service.js';
import { AxTreeCollector } from './observation/ax-tree.collector.js';
import { DomPurifier } from './observation/dom-purifier.js';
import { PageStateDetector } from './observation/page-state.detector.js';
import { SignalsCollector } from './observation/signals-buffer.js';

export const INFRA_PROVIDERS = [
  PlaywrightHarness,
  PlaywrightQuiescenceGuard,
  FormLoginService,
  AxTreeCollector,
  DomPurifier,
  PageStateDetector,
  SignalsCollector,
  ObservationService,
  ReportRenderer,
  FileRunRepository,
  RunDirectoryManager,
  FakeDecisionProvider,
  LlmOutputSanitizer,
  JsonObjectExtractor,
  SafeJsonParser,
  LlmPlanPatchNormalizer,
  GroqDecisionProvider,
  OpenAiLangChainDecisionProvider,
  DecisionRouterProvider,
  FileConfigLoader,
  FilePreflightReportWriterAdapter,
  FileDemandContextWriterAdapter,
  FilePrDiffContextWriterAdapter,
  FileCorrelationArtifactsWriterAdapter,
  ExecGitRepositoryAdapter,
  FetchClickUpApiAdapter,
  ClickUpHttpReaderAdapter,
  FakeClickUpReaderAdapter,
  FetchGitHubApiAdapter,
  FileGitHubEventContextAdapter,
  GitHubActionsPrContextReaderAdapter,
  { provide: 'BrowserHarnessPort', useExisting: PlaywrightHarness },
  { provide: 'RunRepositoryPort', useExisting: FileRunRepository },
  { provide: 'DecisionProviderPort', useExisting: DecisionRouterProvider },
  { provide: 'ConfigLoaderPort', useExisting: FileConfigLoader },
  { provide: 'PreflightReportWriterPort', useExisting: FilePreflightReportWriterAdapter },
  { provide: 'DemandContextWriterPort', useExisting: FileDemandContextWriterAdapter },
  { provide: 'PrDiffContextWriterPort', useExisting: FilePrDiffContextWriterAdapter },
  { provide: 'CorrelationArtifactsWriterPort', useExisting: FileCorrelationArtifactsWriterAdapter },
  { provide: 'GitRepositoryPort', useExisting: ExecGitRepositoryAdapter },
  { provide: 'ClickUpApiPort', useExisting: FetchClickUpApiAdapter },
  { provide: 'ClickUpReaderPort', useExisting: ClickUpHttpReaderAdapter },
  { provide: 'GitHubApiPort', useExisting: FetchGitHubApiAdapter },
  { provide: 'GitHubEventContextPort', useExisting: FileGitHubEventContextAdapter },
  { provide: 'GitHubActionsPrContextReaderPort', useExisting: GitHubActionsPrContextReaderAdapter },
];

@Module({ providers: INFRA_PROVIDERS, exports: INFRA_PROVIDERS })
export class InfraModule {}
