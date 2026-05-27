# Agent QA — Agent Instructions

**agent-qa** is an LLM-guided QA runtime (TypeScript, NestJS, Playwright, Zod) that executes web flows via CLI (`qa-agent`).

## Start here

1. Read all files in [`.cursor/memory/`](.cursor/memory/README.md) — project context is in Portuguese.
2. Follow project rules in [`.cursor/rules/`](.cursor/rules/) — rules are in English.
3. Always-applied rules: `project-core`, `agentic-memory-bank`.

## Runtime product memory

- [`.agent-qa/memory.md`](.agent-qa/memory.md) — searchable QA knowledge for runs
- [`.agent-qa/structure.md`](.agent-qa/structure.md) — chunk format and types

## Legacy

Do **not** edit [`.windsurf/agents.md`](.windsurf/agents.md). Canonical source for Cursor is `.cursor/` + this file.

## Before committing

```bash
npm run check
```

## Pipeline preflight (CI)

Validates ClickUp/GitHub/git context before PR pipeline steps. Writes `preflight-report.json` via `PreflightReportWriterPort`.

```bash
npm run qa-agent -- preflight --output-dir ./.agent-qa/pipeline
```

Exit code `6` when the report status is `BLOCKED`. Config validation reuses `ValidateConfigUseCase` with `skipHealthCheck` (no `HEAD` fetch in CI).

## PR diff context (CI)

Reads GitHub Actions PR metadata and structured diff via `GitHubActionsPrContextReaderPort`. Writes `pr-diff-context.json` (contract `pr-diff-context.v1`) to the pipeline output directory. Run after preflight passes.

```bash
npm run qa-agent -- read-pr-context --output-dir ./.agent-qa/pipeline
```

Exit code `0` on success. Propagates `PrContextReaderError` as harness fatal (exit `3`) when PR context or git diff is unavailable.
