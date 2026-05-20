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
import { ValidationBinderService } from './services/validation-binder.service.js';
import { CaptureAuthUseCase } from './use-cases/capture-auth.usecase.js';
import { InspectRunUseCase } from './use-cases/inspect-run.usecase.js';
import { ReportRunUseCase } from './use-cases/report-run.usecase.js';
import { RunAgentUseCase } from './use-cases/run-agent.usecase.js';
import { ValidateConfigUseCase } from './use-cases/validate-config.usecase.js';
import { InfraModule } from '../infra/infra.module.js';

export const APPLICATION_PROVIDERS = [
  AgentService, RunAgentUseCase, ValidateConfigUseCase, InspectRunUseCase, ReportRunUseCase, CaptureAuthUseCase,
  DataHarnessService, LocatorResolverService, ValidationBinderService, ActionPolicyService, RecoveryPolicyService,
  SanitizerService, BugClassifierService, EvidenceService, ScenarioPlannerService,
];

@Module({ imports: [InfraModule], providers: APPLICATION_PROVIDERS, exports: APPLICATION_PROVIDERS })
export class ApplicationModule {}
