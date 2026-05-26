import { Module } from '@nestjs/common';
import { FileConfigLoader } from './config/file-config.loader.js';
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
  ExecGitRepositoryAdapter,
  { provide: 'BrowserHarnessPort', useExisting: PlaywrightHarness },
  { provide: 'RunRepositoryPort', useExisting: FileRunRepository },
  { provide: 'DecisionProviderPort', useExisting: DecisionRouterProvider },
  { provide: 'ConfigLoaderPort', useExisting: FileConfigLoader },
  { provide: 'GitRepositoryPort', useExisting: ExecGitRepositoryAdapter },
];

@Module({ providers: INFRA_PROVIDERS, exports: INFRA_PROVIDERS })
export class InfraModule {}
