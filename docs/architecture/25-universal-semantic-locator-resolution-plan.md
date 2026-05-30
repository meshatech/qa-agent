# Universal Semantic Locator Resolution Plan

## Goal

Reduce dependence on LLM-produced literal targets such as `Tema visual`, `Logout`, or `Conta|Configuracoes` by strengthening deterministic locator resolution.

The runtime should remain generic across frontends: it should use the current `ScreenObservation`, accessible element metadata, typed `ExpectedOutcome`, memory, and existing guarded executor flow before falling back to `replan` or `decide`.

The target remains no more than 5 LLM calls for the MeshaMail smoke while improving portability to other applications.

## Constraints

- No app-specific hardcoded labels, routes, or selectors.
- No new regex-based semantic heuristics.
- `PlanExecutorService` remains the authority final of execution.
- The LLM does not execute Playwright directly.
- Direct Playwright actions do not become public tools.
- The solution must improve deterministic resolution, not hide failures by disabling validation.

## Current Weak Point

`LocatorResolverService` currently resolves by exact locator equality or substring matching across observed fields:

- element name;
- visible text;
- `aria-label`;
- `title`;
- `alt`;
- class name.

This works when the LLM target and UI label overlap directly. It is weaker when the LLM returns a business-level phrase and the UI exposes a more specific label.

Example pattern:

- target from LLM: `Tema visual`;
- observed UI label: `Tema escuro` or equivalent;
- direct substring matching may fail even though there is a meaningful shared term.

## Proposed Attempts

### U0 - Baseline

Use the best current smoke result:

- Status: `PASSED`.
- LLM calls: `5`.
- Breakdown: `plan=1`, `classifyOutcome=1`, `buildPlan=0`, `replan=1`, `decide=1`.
- Runtime: `35062ms`.

The goal is to preserve pass status and reduce or remove the remaining executor fallback calls.

### U1 - Generic Token Overlap Locator Matching

Add a generic scoring path in `LocatorResolverService` after exact/substring matching fails.

Rules:

- tokenize expected target text and observed element metadata using `Intl.Segmenter` when available;
- fall back to whitespace splitting only;
- score overlap between expected tokens and observed element fields;
- prefer actionable elements when scores tie;
- require a minimum confidence before returning a match;
- do not use application-specific words, routes, or selectors;
- do not use new regex heuristics.

Expected result:

- phrases like `Tema visual` can match observed labels with partial semantic overlap;
- fewer `LOCATOR_NOT_FOUND` recoveries;
- fewer `replan` and `decide` calls.

Attempt result:

- First implementation reduced LLM calls to `3`, but failed logout because fuzzy matching was too permissive for a single-token target.
- The rule was tightened so token-overlap fallback only applies when the expected target has two or more tokens.
- Final smoke result: `PASSED`, `2` LLM calls, `0` `replan`, `0` `decide`, `4` steps, `0` bugs, `22518ms`.
- The remaining calls are planning-level only: `plan=1`, `classifyOutcome=1`.

### U2 - Structured Match Result

If U1 works, extract the scoring into a small responsibility inside `LocatorResolverService` or a focused helper class later.

Keep this first pass simple to avoid broad refactors while the runtime behavior is being validated.

### U3 - Future Memory-Aware Resolution

If U1 is insufficient for icon-only or unlabeled controls, add a future generic memory layer:

- store successful locator resolutions as semantic locator learnings;
- query memory by `ExpectedOutcome` and step intent;
- use learned candidates before LLM fallback;
- keep learned data project-scoped, not hardcoded in source.

## Acceptance Criteria

- MeshaMail smoke stays `PASSED`.
- LLM calls stay at or below `5`.
- Deterministic locator resolution handles partial target/label overlap.
- No new MeshaMail-specific labels, routes, selectors, or DOM assumptions are added.
- No new regex-based semantic rules are added.
- `PlanExecutorService` and guarded execution boundaries remain unchanged.
