# Agent QA Universal — Spec Docs (MVP v0.1)

Specs do MVP focadas no **patch final**: 4 ajustes obrigatórios que dão maturidade operacional ao loop reativo.

## Lei do runtime

```txt
Nenhuma ação executa sem observationId atual.
Nenhuma observação reaproveita IDs antigos.
Nenhuma validação usa dado dinâmico não resolvido.
Nenhuma decisão nova ocorre antes da quiescência.
Nenhum estado flutuante fica sem rota de escape.
```

## Índice

### Núcleo runtime (patch final MVP v0.1)

- [01 — Overview do patch MVP v0.1](./01-overview.md)
- [02 — Quiescence Guard](./02-quiescence-guard.md)
- [03 — IDs efêmeros por observação](./03-ephemeral-ids.md)
- [04 — Data Harness + RunDataStore](./04-data-harness.md)
- [05 — Ações globais de emergência](./05-emergency-actions.md)
- [06 — Contrato final da ação da LLM](./06-llm-action-contract.md)
- [07 — Fluxo runtime definitivo](./07-runtime-flow.md)
- [08 — Status e erros runtime](./08-status-and-errors.md)
- [09 — ADR: Loop reativo com quiescência, IDs efêmeros e dados dinâmicos](./09-adr-reactive-loop.md)
- [10 — Backlog Épico 10 (robustez operacional)](./10-backlog.md)

### Contratos e modelos

- [11 — LLM Prompting (system prompt, retry, budget)](./11-llm-prompting.md)
- [12 — Domain Model (Run/Demand/Scenario/Task/Step/Bug)](./12-domain-model.md)
- [13 — Observation + Locators + DOM Purifier](./13-observation-and-locators.md)
- [14 — Action Catalog (schemas Zod completos)](./14-action-catalog.md)

### Operação e qualidade

- [15 — Bug Classifier + Recovery Policy](./15-bug-classifier-and-recovery.md)
- [16 — Evidence + Run Directory](./16-evidence-and-run-directory.md)
- [17 — Configuration + CLI](./17-configuration-and-cli.md)
- [18 — Security, Privacy + Schema Versioning](./18-security-and-versioning.md)
- [19 — Glossary](./19-glossary.md)

### Arquitetura e implementação v0.1

- [20 — ADR: TypeScript + NestJS com LangChain como adaptador LLM](./20-adr-typescript-nest-langchain.md)
- [21 — Estrutura de implementação v0.1](./21-v0.1-implementation-structure.md)

## Escopo

Specs cobrem MVP v0.1 do Agent QA Universal: núcleo runtime reativo, contratos LLM/Harness/Playwright, modelo de domínio, operação, segurança, versionamento e estrutura de implementação TypeScript/NestJS. Docs 01–10 são o **patch final** (ajustes obrigatórios). Docs 11–19 são **enriquecimento** das pontas soltas restantes. Docs 20–21 definem arquitetura e plano de implementação v0.1.

## Regra central

```txt
Depois de toda ação:
  1. executar ação
  2. aguardar quiescência
  3. invalidar IDs antigos
  4. reobservar tela
  5. validar usando dados reais resolvidos
  6. só então pedir próxima decisão à LLM
```
