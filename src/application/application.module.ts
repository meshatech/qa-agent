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
import { StateContractTranslatorService } from './services/state-contract-translator.service.js';
import { SemanticIntentDetectorService } from './services/semantic-intent-detector.service.js';
import { SemanticLocatorMemoryResolverService } from './services/semantic-locator-memory-resolver.service.js';
import { ExpectedOutcomeResolverService } from './services/expected-outcome-resolver.service.js';
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
import { DemandContextPersistenceService } from './services/demand-context-persistence.service.js';
import { PrDiffContextPersistenceService } from './services/pr-diff-context-persistence.service.js';
import { QaToolRegistry } from './tools/qa-tool-registry.js';
import { ALL_QA_TOOLS } from './tools/built-in/index.js';
import { CaptureAuthUseCase } from './use-cases/capture-auth.usecase.js';
import { InspectRunUseCase } from './use-cases/inspect-run.usecase.js';
import { ReportRunUseCase } from './use-cases/report-run.usecase.js';
import { RunAgentUseCase } from './use-cases/run-agent.usecase.js';
import { ValidateConfigUseCase } from './use-cases/validate-config.usecase.js';
import { RunOnboardingUseCase } from './use-cases/run-onboarding.usecase.js';
import { RunPipelinePreflightUseCase } from './use-cases/run-pipeline-preflight.usecase.js';
import { RunPrDiffContextUseCase } from './use-cases/run-pr-diff-context.usecase.js';
import { RunPipelinePrepareUseCase } from './use-cases/run-pipeline-prepare.usecase.js';
import { RunPipelineCorrelateUseCase } from './use-cases/run-pipeline-correlate.usecase.js';
import { RunPipelineGeneratePlanUseCase } from './use-cases/run-pipeline-generate-plan.usecase.js';
import { PersistSelectedScenariosUseCase } from './use-cases/persist-selected-scenarios.usecase.js';
import { PersistExecutionPlanUseCase } from './use-cases/persist-execution-plan.usecase.js';
import { PersistGherkinScenariosUseCase } from './use-cases/persist-gherkin-scenarios.usecase.js';
import { DemandDiffMemoryCorrelatorService } from './services/demand-diff-memory-correlator.service.js';
import { ScenarioSelectorService } from './services/scenario-selector.service.js';
import { MemoryScenarioSelector } from './services/scenario-selectors/memory-scenario-selector.service.js';
import { RouteScenarioSelector } from './services/scenario-selectors/route-scenario-selector.service.js';
import { ComponentScenarioSelector } from './services/scenario-selectors/component-scenario-selector.service.js';
import { CriteriaScenarioSelector } from './services/scenario-selectors/criteria-scenario-selector.service.js';
import { ScenarioOrchestratorService } from './services/scenario-orchestrator.service.js';
import { ScenarioGeneratorService } from './services/scenario-generator.service.js';
import { ExecutionPlanBuilder } from './services/execution-plan-builder.service.js';
import { GherkinRendererService } from './services/gherkin-renderer.service.js';
import { PRReporterService } from './services/pr-reporter.service.js';
import { PRReportRenderer } from './services/pr-report-renderer.service.js';
import { LearningExtractorService } from './services/learning-extractor.service.js';
import { RiskClassifierService } from './services/risk-classifier.service.js';
import { ValueGeneratorService } from './services/value-generator.service.js';
import { InfraModule } from '../infra/infra.module.js';

export const APPLICATION_PROVIDERS = [
  AgentService, RunAgentUseCase, ValidateConfigUseCase, InspectRunUseCase, ReportRunUseCase, CaptureAuthUseCase, RunOnboardingUseCase, RunPipelinePreflightUseCase, RunPrDiffContextUseCase, RunPipelinePrepareUseCase, RunPipelineCorrelateUseCase, RunPipelineGeneratePlanUseCase,
  DataHarnessService, LocatorResolverService, ValidationBinderService, ActionPolicyService, RecoveryPolicyService,
  SanitizerService, BugClassifierService, EvidenceService, ScenarioPlannerService, ScenarioGeneratorService, TaskMemoryService, StateContractTranslatorService, SemanticIntentDetectorService, SemanticLocatorMemoryResolverService, ExpectedOutcomeResolverService, ExecutionPlanFactoryService, ExecutionPlanPlannerService, ExecutionPlanBuilder, GherkinRendererService, ElementAvailabilityResolver, PlanPatchApplierService, PlanExecutorService, PlanReplannerService, PlaywrightSpecExporter, AgentQaLayoutService, MemoryMarkdownLoader, MemoryChunker, BM25MemoryIndex, RunHistoryService, ProjectOnboardingService, ReadinessEvaluatorService, BaselineSmokeBuilderService, PipelinePreflightService, DemandContextPersistenceService, PrDiffContextPersistenceService, DemandDiffMemoryCorrelatorService, MemoryScenarioSelector, RouteScenarioSelector, ComponentScenarioSelector, CriteriaScenarioSelector, ScenarioSelectorService, ScenarioOrchestratorService, PersistSelectedScenariosUseCase, PersistExecutionPlanUseCase, PersistGherkinScenariosUseCase, PRReporterService, PRReportRenderer, LearningExtractorService, RiskClassifierService, ValueGeneratorService,
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
