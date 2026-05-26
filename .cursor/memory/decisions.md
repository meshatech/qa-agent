# Decisões — tooling agêntico

> Log de decisões sobre configuração Cursor/agente. Estabilidade média — atualizar quando houver mudança de política.

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
