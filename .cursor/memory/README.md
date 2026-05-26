# Memory Bank — agent-qa

Memória persistente para agentes Cursor que desenvolvem este repositório. Arquivos em **português**; rules do projeto em **inglês** (`.cursor/rules/`).

Entrada do projeto: [`AGENTS.md`](../AGENTS.md) na raiz.

## Arquivos

| Arquivo | Estabilidade | Conteúdo |
|---------|--------------|----------|
| `project-brief.md` | Alta | O que é o projeto, stack, escopo |
| `architecture.md` | Média | Camadas, módulos, loop runtime, mapa de services |
| `conventions.md` | Média | Estilo de código e DI |
| `decisions.md` | Média | Decisões de tooling agêntico (evitar re-debates) |
| `active-context.md` | **Volátil** | Foco atual da equipe/agente |
| `progress.md` | **Volátil** | Feito, em andamento, próximo |

## Workflow (obrigatório para agentes)

1. **Início da tarefa**: ler todos os arquivos desta pasta.
2. **Durante**: consultar `doc/` antes de mudar comportamento runtime.
3. **Fim de trabalho relevante**: atualizar `active-context.md` e `progress.md`.
4. **Conhecimento útil em runs de QA**: espelhar em `.agent-qa/memory.md` (ver `.agent-qa/structure.md`).

## Checklist pós-tarefa (copy-paste)

```markdown
- [ ] Li `.cursor/memory/` no início
- [ ] Atualizei `active-context.md` (se foco/bloqueios mudaram)
- [ ] Atualizei `progress.md` (se entregas/roadmap mudaram)
- [ ] Espelhei conhecimento estável em `.agent-qa/memory.md` (se aplicável)
- [ ] Rodei `npm run validate:agent-config`
```

## Política de sync

### Com `.windsurf/agents.md`

- **Não editar** — legado Windsurf
- Se conteúdo divergir, **`.cursor/` + `AGENTS.md` vencem**

### Com `.agent-qa/memory.md`

| Situação | Ação |
|----------|------|
| Nova rota, flow ou locator estável para QA | Adicionar chunk em `memory.md` |
| Decisão arquitetural do produto | Atualizar `doc/` + chunk `project` se relevante para runs |
| Estado volátil de sessão de dev | Só `active-context.md` — não espelhar |
| Scratch de uma run | `run-history.jsonl` (futuro) — não `memory.md` |

## Relação com outras memórias

- **`.agent-qa/memory.md`** — memória do produto para execuções de QA (indexação BM25 planejada).
- **`TaskMemoryService`** — memória efêmera por task durante uma run; não persiste entre execuções.

## Segurança

Nunca incluir tokens, chaves de API, senhas literais ou valores de variáveis de ambiente nestes arquivos.
