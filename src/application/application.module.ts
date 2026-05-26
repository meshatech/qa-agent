import { Module } from '@nestjs/common';
import { AgentService } from './services/agent.service.js';
import { ActionPolicyService } from './services/action-policy.service.js';
import { BugClassifierService } from './services/bug-classifier.service.js';
import { DataHarnessService } from './services/data-harness.service.js';
import { EvidenceService } from './services/evidence.service.js';
import { LocatorResolverService } from './services/locator-resolver.service.js';
import { RecoveryPolicyService } from './services/recovery-policy.service.js';
import { SanitizerService } from './services/sanitizer.service.js';
import { ScenarioPlannerService } from './services/scenario-planner.service.js';
import { TaskMemoryService } from './services/task-memory.service.js';
import { ValidationBinderService } from './services/validation-binder.service.js';
import { ExecutionPlanFactoryService } from './services/execution-plan-factory.service.js';
import { ExecutionPlanPlannerService } from './services/execution-plan-planner.service.js';
import { ElementAvailabilityResolver } from './services/element-availability-resolver.service.js';
import { PlanPatchApplierService } from './services/plan-patch-applier.service.js';
import { PlanExecutorService } from './services/plan-executor.service.js';
import { PlanReplannerService } from './services/plan-replanner.service.js';
import { PlaywrightSpecExporter } from './services/playwright-spec-exporter.service.js';
import { MemoryChunker } from './services/memory-chunker.service.js';
import { BM25MemoryIndex } from './services/bm25-memory-index.service.js';
import { MemoryMarkdownLoader } from './services/memory-markdown-loader.service.js';
import { MemorySearchService } from './services/memory-search.service.js';
import { AgentQaLayoutService } from './services/agent-qa-layout.service.js';
import { RunHistoryService } from './services/run-history.service.js';
import { ProjectOnboardingService } from './services/project-onboarding.service.js';
import { ReadinessEvaluatorService } from './services/readiness-evaluator.service.js';
import { BaselineSmokeBuilderService } from './services/baseline-smoke-builder.service.js';
import { PipelinePreflightService } from './services/pipeline-preflight.service.js';
import { QaToolRegistry } from './tools/qa-tool-registry.js';
import { ALL_QA_TOOLS } from './tools/built-in/index.js';
import { CaptureAuthUseCase } from './use-cases/capture-auth.usecase.js';
import { InspectRunUseCase } from './use-cases/inspect-run.usecase.js';
import { ReportRunUseCase } from './use-cases/report-run.usecase.js';
import { RunAgentUseCase } from './use-cases/run-agent.usecase.js';
import { ValidateConfigUseCase } from './use-cases/validate-config.usecase.js';
import { RunOnboardingUseCase } from './use-cases/run-onboarding.usecase.js';
import { InfraModule } from '../infra/infra.module.js';

export const APPLICATION_PROVIDERS = [
  AgentService, RunAgentUseCase, ValidateConfigUseCase, InspectRunUseCase, ReportRunUseCase, CaptureAuthUseCase, RunOnboardingUseCase,
  DataHarnessService, LocatorResolverService, ValidationBinderService, ActionPolicyService, RecoveryPolicyService,
  SanitizerService, BugClassifierService, EvidenceService, ScenarioPlannerService, TaskMemoryService, ExecutionPlanFactoryService, ExecutionPlanPlannerService, ElementAvailabilityResolver, PlanPatchApplierService, PlanExecutorService, PlanReplannerService, PlaywrightSpecExporter, AgentQaLayoutService, MemoryMarkdownLoader, MemoryChunker, BM25MemoryIndex, RunHistoryService, ProjectOnboardingService, ReadinessEvaluatorService, BaselineSmokeBuilderService, PipelinePreflightService,
  { provide: QaToolRegistry, useFactory: () => new QaToolRegistry(ALL_QA_TOOLS) },
  {
    provide: MemorySearchService,
    useFactory: (chunker: MemoryChunker, index: BM25MemoryIndex, loader: MemoryMarkdownLoader) =>
      new MemorySearchService(chunker, index, loader),
    inject: [MemoryChunker, BM25MemoryIndex, MemoryMarkdownLoader],
  },
];

@Module({ imports: [InfraModule], providers: APPLICATION_PROVIDERS, exports: APPLICATION_PROVIDERS })
export class ApplicationModule {}
