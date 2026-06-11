# Decisões — tooling agêntico

> Log de decisões sobre configuração Cursor/agente. Estabilidade média — atualizar quando houver mudança de política.

## 2026-06 — Known security gap (MESHAP-3975, documentado — sem purge)

- **`meshamail-auth.json`** foi removido do índice (`git rm --cached`) e está no `.gitignore`, mas **ainda existe em `HEAD` e no histórico** (ex.: commit `b3452b1`) até um commit de remoção + eventual purge
- `git rm --cached` **não** apaga o histórico permanente — credencial pode permanecer exposta em clones antigos
- **Pendências futuras** (fora do escopo atual): (a) commitar a remoção definitiva, (b) purgar histórico (`git filter-repo` / BFG, reescrita destrutiva + force-push), (c) rotacionar credencial exposta
- Nunca armazenar tokens/senhas literais em memory files ou configs versionados

## 2026-06 — G9 Tool Queue (MESHAP-3975)

- **Tool Queue** (`runtime.tools.enabled`) permanece **opt-in** com default `false`
- Caminho canônico da v2: `HYBRID_GUARDED` + factory fallback
- Branch `feature/sub-agent-orchestrator` contém o código; merge para main é decisão operacional separada

## 2026-06 — URL dinâmica em CI (MESHAP-3975)

- **`QA_AGENT_BASE_URL`** tem precedência sobre `config.baseUrl` após parse Zod
- **`QA_AGENT_PREVIEW_DOMAIN`** (ex. `*.preview.meshamail.dev`) injeta o domínio base (sem `*.`) em `appDomains`
- Helper central: `src/application/helpers/apply-base-url-override.ts`

## 2026-05 — Configuração inicial `.cursor/`

- **Rules em inglês**, memory files em **português**
- `.cursor/` é **canônico** para Cursor; `.windsurf/agents.md` é legado (não editar)
- Três memórias distintas: `.cursor/memory/` (dev), `.agent-qa/` (runtime QA), `TaskMemoryService` (efêmero)

## 2026-05 — Elevação nota 10

- **`AGENTS.md`** na raiz como entrada única
- **12 rules** incluindo services, playwright/observation e CLI
- **DoD** na rule `agentic-memory-bank` + checklist no README
- **Sem Cursor hooks** — validação via `npm run validate:agent-config`
- **Credenciais**: nunca literais em memory files; referenciar env/config (`usernameEnv`, `passwordEnv`)
- **Chunks** em `.agent-qa/memory.md` com `type` + `id` únicos; validados pelo script

## Princípios mantidos

- Não duplicar specs de `doc/` — referenciar paths
- Espelhar para `.agent-qa/` só conhecimento **estável** útil em runs de QA
- `npm run check` inclui `validate:agent-config` — rodar antes de commit de mudanças em `.cursor/` ou `.agent-qa/`
