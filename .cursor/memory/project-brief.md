# Project Brief — agent-qa

## O que é

Runtime de QA guiado por LLM que executa fluxos web via Playwright: observa a tela, decide a próxima ação, executa, valida, recupera falhas e gera evidências.

- **Pacote**: `agent-qa` v0.1.0
- **CLI**: `qa-agent` (Commander + NestJS)
- **Release runtime estável documentada**: v0.2-stable (`doc/release-notes/v0.2-stable.md`)

## Stack

TypeScript strict, ESM, NestJS, Playwright, Zod v4, LangChain apenas como adaptador LLM em `infra/llm/`.

## Providers e browser

- **LLM**: `fake`, `groq`, `openai` (fallback factory quando plano LLM falha)
- **Browser**: `chromium`, `firefox`, `webkit`
- **Auth**: `none`, `storageState`, `formLogin`

## Modos de execução

- **FULL_REACTIVE** — loop clássico observe → decide → act
- **Hybrid Guarded** (v0.2) — `HYBRID_GUARDED`, `PLAN_AND_EXECUTE` com ExecutionPlan, QaToolRegistry, replan e export Playwright experimental

## Entregas atuais

- Validação de config (JSON/YAML/TS/JS)
- Preflight (envs + HEAD no `baseUrl`)
- Recovery, bug classifier, diretório de run com relatórios e pasta de bugs
- Sanitização básica de dados sensíveis

## Fora de escopo implementado

Pipeline PR (ClickUp, diff GitHub, BM25 memory services, correlação demanda/diff) — especificado em `tasks-clickup/`, código ainda não presente em `src/`.

## Comandos essenciais

```bash
npm test && npm run typecheck && npm run lint
npm run qa-agent -- validate-config --config ./agent-qa.fixture.config.json
npm run qa-agent -- run --config ./agent-qa.fixture.config.json
```
