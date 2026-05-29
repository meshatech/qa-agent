# MeshaMail LLM and Snapshot Reduction Plan

## Goal

Reduce the MeshaMail smoke execution from the observed baseline of 19 LLM calls toward a target close to the number of executable steps, ideally no more than 5 total calls, without weakening the guarded runtime.

This plan must not introduce app-specific hardcoded labels, routes, or DOM assumptions. It must also avoid new regex-based intent heuristics. Reductions should come from typed contracts, configuration, caching, service boundaries, and reuse of already validated runtime capabilities.

## Current Call Sources

Likely LLM call sources in the current runtime:

- `ScenarioPlannerService` calls `DecisionProviderPort.plan`.
- `ExpectedOutcomeResolverService` may call `classifyOutcome` once per task when the scenario task has no typed `expectedOutcome`.
- `ExecutionPlanPlannerService` calls `DecisionProviderPort.buildPlan`.
- `PlanExecutorService` calls `DecisionProviderPort.decide` only as a fallback when deterministic locator resolution fails.
- `PlanReplannerService` calls `DecisionProviderPort.replan` only on recovery paths.

Likely snapshot source:

- `ObservationService.observe` currently captures a screenshot base64 on every observation, even when the consumer only needs DOM/accessibility/text/state.

## Constraints

- `PlanExecutorService` remains the execution authority.
- The LLM must not execute Playwright directly.
- No public `click`, `fill`, `press`, or `navigate` tools.
- No new MeshaMail-specific hardcoded labels or route checks.
- No new regex-based semantic shortcuts.
- Zod schemas, policy checks, preconditions, postconditions, quiescence, and evidence/reporting remain active.

## Attempts

### A0 - Baseline Measurement

Run:

```bash
npm run qa-agent -- run --config agent-qa.meshamail.config.json
```

Record:

- pass/fail status;
- total LLM calls;
- breakdown by `plan`, `classifyOutcome`, `buildPlan`, `decide`, and `replan`;
- number of generated screenshots/snapshots when visible in the output or artifacts.

Baseline measured locally:

- Status: `PASSED`.
- Total LLM calls: `17`.
- Reported breakdown before instrumentation: `plan=1`, `buildPlan=1`, `replan=2`, `decide=2`.
- Runtime: `199210ms`.
- Result: `5` steps passed, `0` bugs.
- Note: `classifyOutcome` was not visible in the breakdown before A1, so hidden calls/retries require instrumentation before final attribution.

### A1 - Add Missing LLM Breakdown

Add `classifyOutcome` to the provider call breakdown so each optimization has a measurable effect.

Expected result:

- no behavior change;
- clearer measurement of per-task classification cost.

Result:

- The first instrumented run passed with `21` total provider calls.
- The breakdown exposed `classifyOutcome=4`, confirming one outcome classification call per task.
- Duration improved to `181310ms` after observation screenshots became opt-in.

### A2 - Preserve Typed Expected Outcomes from Scenario Planning

Make the scenario planner prompt and provider normalizers preserve `expectedOutcome` when the planner returns it.

Expected result:

- reduce or eliminate per-task `classifyOutcome` calls;
- keep planning provider-agnostic;
- avoid app-specific labels or regex heuristics.

Result:

- Batch classification reduced logical classification from `4` calls to `1`.
- An intermediate run blocked because the batch prompt degraded one logout outcome to navigation and transient provider fetch failures hit executor fallback.
- The batch prompt was tightened with generic rules for logout/deauthentication and appearance changes.

### A3 - Make Observation Screenshots Opt-In

Add a runtime observation option so base64 screenshots are captured only when explicitly requested.

Expected result:

- reduce snapshot overhead during normal observe cycles;
- keep `BrowserHarnessPort.screenshot()` available for evidence and `qa.screen.observe`;
- avoid changing execution semantics.

Result:

- `runtime.observation.includeScreenshot` was added as an opt-in option.
- Normal observations no longer capture screenshot base64 by default.
- Dedicated screenshot capture remains available through `BrowserHarnessPort.screenshot()`.

### A4 - Re-run Smoke and Compare

Run the MeshaMail smoke after each implementation attempt and compare:

- total calls;
- call breakdown;
- duration;
- final status and bugs;
- whether any fallback or replan increased because of the optimization.

Final measured result:

- Status: `PASSED`.
- Total LLM calls: `5`.
- Breakdown: `plan=1`, `classifyOutcome=1`, `buildPlan=0`, `replan=1`, `decide=1`.
- Runtime: `35062ms`.
- Result: `4` steps passed, `0` bugs.
- `agent-qa.meshamail.config.json` uses configurable `runtime.planning.executionPlanStrategy: "factory_first"` to skip an LLM build-plan attempt that was consistently falling back to the safe factory.
- The theme flow now uses the typed `ExpectedOutcome.target` directly instead of generating an extra conceptual menu-trigger step.

### A5 - Future Safe Reductions

If calls remain above target after A1-A3, consider follow-up changes that preserve architecture:

- reuse validated `ExecutionPlanFactoryService` when scenario tasks already include typed expected outcomes and the runtime has enough semantic locator context;
- add a configurable per-run budget for executor `decide` fallback calls;
- cache equivalent scenario/outcome planning results by demand hash and config fingerprint;
- improve semantic locator memory so deterministic resolution succeeds before LLM fallback.

## Success Criteria

- MeshaMail smoke still passes.
- LLM calls are materially reduced from 19.
- Observation screenshots are no longer captured on every observe call by default.
- No new hardcoded MeshaMail labels, routes, or DOM assumptions are introduced.
- No new regex-based semantic rules are introduced.
- Runtime safety boundaries remain unchanged.
