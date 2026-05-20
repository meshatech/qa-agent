# 19 — Glossary

## Termos do domínio

| Termo | Definição |
|-------|-----------|
| **Agent QA** | Sistema de teste automatizado guiado por LLM, acoplado a frontend |
| **Harness** | Bancada controladora. Observa, executa, registra. Inclui Playwright e periféricos |
| **Orchestrator** | Serviço que coordena ciclo Observe→Decide→Act→Validate |
| **LLM** | Modelo de linguagem que escolhe próxima ação. Nunca executa código |
| **DecisionProvider** | Interface interna que transforma contexto de runtime em `QaActionEnvelope` |
| **LangChainDecisionProvider** | Adapter LLM opcional baseado em LangChain JS. Usado só dentro de `LlmModule` |
| **Run** | Execução completa do agente para uma demanda |
| **Scenario** | Conjunto de tasks com objetivo comum. Positivo, negativo, edge ou exploratório |
| **Task** | Intenção de teste. Não carrega seletor. Tem `expected` |
| **Step** | Ciclo concreto Observe→Decide→Act→Validate. Gerado em runtime |
| **Demand** | Demanda funcional bruta do usuário em markdown |

## Termos de observação

| Termo | Definição |
|-------|-----------|
| **ScreenObservation** | Snapshot reduzido da tela enviado à LLM |
| **ObservableElement** | Elemento interativo com `id` efêmero e `locator` interno |
| **observationId** | ID único da observação. Válido até próxima ação |
| **LocatorDescriptor** | Estratégia para resolver elemento (role/label/placeholder/text/testid) |
| **LocatorResolver** | Componente que mantém mapa `el_id → LocatorDescriptor` |
| **DOM Purifier** | Filtra DOM bruto antes de extrair observação |
| **Accessibility Tree** | Árvore ARIA do Playwright. Fonte primária de elementos |
| **Quiescence** | Estado de DOM/network estável após ação |
| **QuiescenceGuard** | Componente que aguarda quiescência |

## Termos de ação

| Termo | Definição |
|-------|-----------|
| **QaAction** | União discriminada das ações atômicas suportadas |
| **QaActionEnvelope** | Resposta JSON da LLM. Inclui `observationId`, `action`, `expected`, `fallback` |
| **ExpectedAfterAction** | Asserção esperada após executar ação |
| **Fallback action** | Ação alternativa se asserção falhar |
| **Emergency action** | `press Escape`, `clickOutside`, `clickAtCoordinates` |
| **Atomic action** | Ação única, indivisível, validada por schema |

## Termos de dados

| Termo | Definição |
|-------|-----------|
| **RunDataStore** | Armazena dados gerados na run para reuso em asserções |
| **DataHarness** | Resolve placeholders `{{...}}` e popula store |
| **Placeholder** | Sintaxe `{{tipo:chave:arg}}` para dados dinâmicos |
| **{{uniqueName:key:prefix}}** | Gera nome único e registra em `key` |
| **{{uniqueEmail:key}}** | Gera email único e registra em `key` |
| **{{ref:key}}** | Lê valor salvo de `key` |

## Termos de erro / recuperação

| Termo | Definição |
|-------|-----------|
| **STALE_OBSERVATION** | Ação referenciou observação obsoleta |
| **LOCATOR_NOT_FOUND** | `targetElementId` não está no `locatorMap` atual |
| **QUIESCENCE_TIMEOUT** | DOM/network não estabilizou em tempo |
| **RECOVERY_EXHAUSTED** | Tentativas de fallback esgotadas |
| **BugClassifier** | Decide se sinal é bug real ou ruído |
| **RecoveryPolicy** | Decide se tenta recovery e qual estratégia |
| **AttemptRecord** | Memória curta de tentativas por task |
| **Recovery budget** | Limite de tentativas (task/step/cenário) |

## Termos de evidência

| Termo | Definição |
|-------|-----------|
| **EvidenceBundle** | Conjunto de arquivos de uma falha (screenshot, vídeo, trace, etc) |
| **EvidenceHarness** | Salva evidência em disco |
| **RunDirectoryManager** | Cria/gerencia diretórios da run |
| **bug-report.md** | Relatório markdown legível por humano |
| **execution-log.json** | Log step-a-step da run |
| **execution-report.md** | Resumo final humano da run |
| **metrics.json** | Métricas agregadas da run |

## Termos de classificação de bug

| Termo | Definição |
|-------|-----------|
| **BugSignalType** | Tipo bruto do sinal (5xx, exceção, timeout, etc) |
| **BugCategory** | Categoria após classificação (APP_FAULT, NOISE, etc) |
| **Severity** | LOW / MEDIUM / HIGH / CRITICAL |
| **isAppOrigin** | Sinal vem de domínio próprio da app (`RunConfig.appDomains`) |
| **App domain** | Domínio listado em `RunConfig.appDomains` |
| **Third-party noise** | Erro de domínio externo (analytics, ads, fonts) |

## Termos de configuração

| Termo | Definição |
|-------|-----------|
| **RunConfig** | Configuração completa da run (Zod) |
| **storageState** | Arquivo JSON do Playwright com cookies/localStorage |
| **Form login** | Estratégia de autenticação preenchendo formulário |
| **Allowed routes** | Rotas permitidas para `NavigateAction` |
| **Prompt version** | Versão do system prompt usado na run |
| **NestJS Module** | Unidade de composição da aplicação TypeScript/NestJS |

## Termos de segurança

| Termo | Definição |
|-------|-----------|
| **Sanitizer** | Mascara dados sensíveis antes de persistir |
| **Redacted** | Conteúdo substituído por `***REDACTED***` |
| **App origin** | Origem confiável (config) vs externa |
| **Schema version** | Versão de schema persistido (`obs.v1`, `action.v1`, etc) |

## Abreviações

| Sigla | Significado |
|-------|-------------|
| AX | Accessibility (tree) |
| AOA | Ação Operativa Atômica (informal) |
| OPaV | Observe → Plan → Act → Validate |
| ODAV | Observe → Decide → Act → Validate (ciclo MVP) |
| MVP | Minimum Viable Product |
| ADR | Architecture Decision Record |

## Convenções de ID

Ver doc 12 seção "Convenção de IDs".
