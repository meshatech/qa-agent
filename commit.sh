#!/usr/bin/env bash
set -euo pipefail

# Phase 1 — State-contract-driven execution (remove word/regex intent from main path)
git add src/domain/schemas/expected-outcome.schema.ts
git add src/domain/schemas/required-scenario.schema.ts
git add src/domain/models/run.model.ts
git add src/application/services/state-contract-translator.service.ts
git add src/application/services/execution-plan-factory.service.ts
git add src/application/application.module.ts
git add test/state-contract-translator.service.spec.ts
git add test/execution-plan-factory.contract.spec.ts
git add test/execution-plan-factory.service.spec.ts
git add test/execution-plan-planner.spec.ts
git add test/execution-plan-builder.service.spec.ts
git add test/build-execution-plan-tool.spec.ts
git commit -m "feat(execution): drive success proof by typed state contract, not words

Replace word/regex intent detection on the main ExecutionPlan path with a
typed state contract declared at the demand layer and translated by the
planner into typed PlanConditions, validated by the runtime against real
application state.

- New: ExpectedOutcome contract (closed enum kind + optional target +
  description) in src/domain/schemas/expected-outcome.schema.ts
  - AUTHENTICATION | DEAUTHENTICATION | NAVIGATION | APPEARANCE_CHANGE
  - DISCLOSURE | CONTENT_PRESENCE | DATA_ENTRY | NO_REGRESSION
- RequiredScenario and QaTask carry optional expectedOutcome (no breaking change)
- New: StateContractTranslatorService maps each kind -> typed PlanCondition[]
  - DEAUTHENTICATION -> auth_state anonymous
  - AUTHENTICATION   -> auth_state authenticated
  - NAVIGATION       -> route_state matches/changed
  - APPEARANCE_CHANGE-> ui_state changed
  - DISCLOSURE       -> menu_state open
  deterministic domain mapping; never inspects free text
- ExecutionPlanFactory builds postconditions from the contract when present;
  legacy regex matchers kept only as @deprecated fallback (Phase 2 cleanup)
- Registered StateContractTranslatorService in ApplicationModule
- 13 translator tests + 7 contract-driven factory tests
- Runtime/proof for logout/login/theme/menu/navigation no longer depends on
  hardcoded words like 'Sair'/'logout'/'tema'

Phase 2 (separate task): clean regex from FULL_REACTIVE loop in
RunAgentUseCase and source locator candidates from memory."

# Fix — pre-existing cross-platform/test bugs surfaced by full suite
git add src/infra/persistence/file-run.repository.ts
git add test/pipeline-preflight.service.spec.ts
git commit -m "fix(infra,test): cross-platform path guard and preflight env-wipe order

- FileRunRepository.resolveInsideRunDir used a hardcoded '/' separator in the
  path-traversal guard, which rejected every valid path on Windows (where the
  separator is '\\'). Use path.sep and allow the runDir itself.
- pipeline-preflight spec wiped all env vars (incl. SystemRoot/windir/TEMP)
  before creating a temp dir, making os.tmpdir() resolve to 'undefined\\temp'.
  Create the temp dir before wiping env."

# Phase 2 — Remove word/regex intent classification from the reactive loop
git add src/application/services/semantic-intent-detector.service.ts
git add src/application/use-cases/run-agent.usecase.ts
git add src/application/application.module.ts
git add test/semantic-intent-detector.service.spec.ts
git add test/run-agent-success-rules.spec.ts
git commit -m "refactor(runtime): classify task intent by typed contract, regex deprecated

Extract intent classification out of RunAgentUseCase's FULL_REACTIVE loop into
a single, isolated SemanticIntentDetectorService.

- New: SemanticIntentDetectorService
  - Primary rule: derive intent from QaTask.expectedOutcome (typed, word-free,
    language-agnostic)
  - Fallback rule (@deprecated): regex over task text for legacy tasks with no
    contract, isolated in one place for Phase-2 removal
- RunAgentUseCase.isLogoutTask/isThemeTask/isMenuTask now delegate to the
  detector instead of inlining pt-BR/en regex
- Registered SemanticIntentDetectorService in ApplicationModule
- 9 detector tests (contract-first + legacy fallback, incl. non-pt/en wording)
- No regression: full suite green (1213 passed)

Remaining Phase-2 follow-up: source locator candidates from memory
(semantic_locator) and evaluate removing FULL_REACTIVE entirely."

# Phase 3 — Connect ExpectedOutcome end-to-end: planner -> factory -> runtime
git add src/infra/llm/prompt-builder.ts
git add src/application/services/scenario-planner.service.ts
git add test/scenario-planner.spec.ts
git add test/planner-deps.spec.ts
git add test/scenario-to-plan.contract.spec.ts
git commit -m "feat(pipeline): wire ExpectedOutcome from planner through factory to runtime

Closes the typed-contract loop end-to-end:

- PLAN_SYSTEM_PROMPT now includes expectedOutcome in the task schema, teaching
  the LLM planner to emit the typed contract alongside each task.
- ScenarioPlannerService:
  - Injected SemanticIntentDetectorService
  - fallback() infers expectedOutcome from task text via detector (deterministic,
    isolated, replaceable once LLM emits the field)
  - canonicalTask normalizes expected text from the contract kind first, then
    falls back to regex only for legacy tasks without expectedOutcome
  - isLogoutTask / isLoginTask prefer expectedOutcome when present; delegate
    to detector otherwise
  - enforcePlanPolicy / authenticatedPlan / authAwareTasks now work with the
    contract, not just words
- New integration test: ScenarioPlanner -> ExecutionPlanFactory pipeline
  proves that fallback-inferred + LLM-provided expectedOutcome both flow into
  typed PlanCondition postconditions (auth_state, route_state, ui_state)
- Full suite green: 1215 passed, 0 failed"

# Phase 4 — Source semantic locator candidates from BM25 memory (no hardcoded words)
git add src/application/services/semantic-locator-memory-resolver.service.ts
git add src/application/services/execution-plan-factory.service.ts
git add src/application/services/execution-plan-planner.service.ts
git add src/application/services/execution-plan-builder.service.ts
git add src/application/application.module.ts
git add test/semantic-locator-memory-resolver.service.spec.ts
git add test/execution-plan-factory.contract.spec.ts
git add test/execution-plan-factory.service.spec.ts
git add test/execution-plan-planner.spec.ts
git add test/execution-plan-builder.service.spec.ts
git add test/build-execution-plan-tool.spec.ts
git add test/scenario-to-plan.contract.spec.ts
git commit -m "feat(factory): source semantic locator candidates from BM25 memory, not hardcoded words

Replaces the last place where hardcoded candidate texts were used in the
contract-driven path: ExecutionPlanFactory.semanticTarget now queries the
project's BM25 memory index for semantic_locator chunks instead of falling
back to [task.title].

- New: SemanticLocatorMemoryResolverService
  - Builds query from ExpectedOutcome.description + .target (demand text, never
    hardcoded words)
  - Searches MemorySearchService limited to 'semantic_locator' chunks
  - Extracts quoted strings, bold labels, and chunk titles as candidates
  - Returns empty array when memory is absent or has no matches; caller falls
    back to outcome.description
- ExecutionPlanFactoryService:
  - Injected SemanticLocatorMemoryResolverService
  - fromScenarios, stepsForTask, contractSteps, contractAction, semanticTarget
    are now async (I/O for memory lookup)
  - semanticTarget queries memory first; falls back to outcome.description
- ExecutionPlanPlannerService and ExecutionPlanBuilder updated to await the
  now-async factory
- All test suites updated with stub resolver and async/await patterns
- 3 new resolver unit tests (empty results, text extraction, target in query)
- Full suite green: 1218 passed, 0 failed"
