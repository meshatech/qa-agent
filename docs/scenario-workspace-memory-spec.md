# Scenario Workspace Memory — Especificação Técnica

**Versão:** 1.0  
**Status:** Especificação para revisão — não implementar ainda  
**Data:** 2026-06-10

---

## 1. Visão Geral

O `Scenario Workspace Memory` (também chamado de `Virtual Run Filesystem`) é uma camada de persistência que transforma cada run do `qa-agent` em um workspace estruturado no filesystem. Ele resolve três problemas simultaneamente:

1. **Vídeo separado por cenário** — cada cenário gera sua própria evidência de vídeo.
2. **Continuidade entre BrowserContexts** — estado mecânico (cookies/storage) e semântico (runtime) persistem entre cenários.
3. **Reaproveitamento do plano global** — a LLM gera o plano uma vez; o sistema fatia por cenário e executa sem chamar a LLM novamente, exceto em caso de drift/falha.

> **Princípio de design:** *Plan Once, Slice Many, Store Everything, Replan Only on Drift.*

---

## 2. Fases de Implementação

### Fase 1 — Plan Once + Slice Many
**Escopo:** `ScenarioPlanSlicer` + estrutura de diretórios + persistência do plano.

**Entregáveis:**
- `ScenarioPlanSlicer` service que agrupa `ExecutionStep[]` por `scenarioId`.
- Arquivos `plan/global-execution-plan.json` e `plan/scenario-slices.json` persistidos no run dir.
- Fallback determinístico para `scenarioId` ausente (herdar do `plan.scenarioId` ou `scenario-001`).
- **Não altera o harness** — continua com contexto único, vídeo único.

**Critérios de aceitação:**
- Plano global é gerado uma vez e salvo.
- `scenario-slices.json` contém fatias separadas por cenário.
- Cada fatia preserva `preconditions`, `postconditions`, `dependencies`.
- Slices podem ser executados sequencialmente no mesmo `BrowserContext` (preparação para Fase 2–3).

---

### Fase 2 — Virtual Run Memory
**Escopo:** Estado estruturado + memória textual.

**Entregáveis:**
- `state/current-state.json` — estado determinístico (auth, URL, tema).
- `state/runtime-memory.md` — estado textual para BM25/LLM.
- `RuntimeMemoryWriter` service para append.
- `RunDirectoryManager` atualizado para criar subpastas `plan/`, `state/`, `evidence/`, `reports/`.

**Critérios de aceitação:**
- Após cada cenário, `current-state.json` é atualizado.
- `runtime-memory.md` recebe append com resumo do cenário.
- `MemorySearchService` carrega `runtime-memory.md` junto com `memory.md`, dando **prioridade** ao `runtime-memory.md` (estado atual vence baseline antigo).

---

### Fase 3 — Multi-context per Scenario
**Escopo:** Vídeo por cenário com contexto isolado.

**Entregáveis:**
- `PlaywrightHarness` suporta `createContextForScenario()` + `closeScenarioContext()`.
- Cada fatia de cenário roda em `BrowserContext` próprio com `recordVideo`.
- `storageState` carregado no início de cada cenário (exceto o primeiro).
- Vídeos salvos como `evidence/videos/scenario-01-login.webm`.

**Critérios de aceitação:**
- Cada cenário tem vídeo próprio com conteúdo real.
- Contexto é recriado entre cenários.
- Storage state é restaurado para manter autenticação.

---

### Fase 4 — Precondition + Recovery
**Escopo:** Validação determinística + recovery + replan sob demanda.

**Entregáveis:**
- `PreconditionValidator` — checa `auth_state`, `route_state` antes de executar fatia.
- `DeterministicRecovery` — tenta restaurar estado sem LLM (ex: reload + storageState).
- Replan só quando recovery falha.

**Critérios de aceitação:**
- Se `current-state.json` diz "autenticado" e storageState carrega OK, executa sem LLM.
- Se precondition falha, recovery é tentado primeiro.
- Se recovery falha, LLM replan é chamado **somente para aquela fatia**.

---

### Fase 5 — Bug Flow + Failure Classification
**Escopo:** Detectar, classificar e registrar falhas estruturadas; decidir se continua ou aborta próximos cenários.

**Entregáveis:**
- `FailureClassifierService` — classifica falhas em `BUG | BLOCKED | DRIFT | INCONCLUSIVE`.
- `BugRecordBuilder` — transforma falha + evidência em `BugRecord` estruturado.
- `ScenarioContinuationPolicy` — decide se próximos cenários rodam, ficam `BLOCKED_BY_PREVIOUS_BUG`, ou run aborta.
- `BugArtifactWriter` — persiste `bugs/BUG-001.json`, atualiza `runtime-memory.md`, `pr-report.md`.

**Classificação de falhas:**

| Categoria | Definição | Exemplo |
|-----------|-----------|---------|
| **BUG** | Aplicação respondeu errado ou quebrou regra esperada. | Login válido não autentica; tema não muda para dark. |
| **BLOCKED** | Agente não conseguiu prosseguir por limitação externa. | Página não carregou; token inválido; ambiente fora do ar. |
| **DRIFT** | Plano desatualizado porque UI mudou, mas não é bug do produto. | Botão "Sair" virou "Encerrar sessão"; menu mudou de lugar. |
| **INCONCLUSIVE** | Não conseguiu provar sucesso nem falha. | Página mudou, mas sem postcondition suficiente. |

**Critérios de aceitação:**
- Postcondition falhou → captura screenshot, DOM, URL, network, console → classifica.
- DRIFT → tenta `Explorer/Replan`; se resolver, continua e registra learning.
- BUG → registra `BugRecord` com evidence paths; atualiza `current-state.json` com `lastFailure`.
- Próximos cenários só são `BLOCKED_BY_PREVIOUS_BUG` se a falha quebra suas preconditions.

---

### Fase 2.5 — MVP Bug Flow

Subfase que pode ser entregue assim que slicing existir, antes da Fase 5 completa.

**Escopo:** Detecção mínima de falha sem classificador LLM completo.

**Regras:**
- Se postcondition falhar → criar `BugRecord` básico (id, scenarioId, expected, actual, severity).
- Salvar paths de screenshot/video/trace no `BugRecord`.
- Marcar cenário como `FAILED` no `run.json`.
- Continuar próximos cenários se suas preconditions ainda são satisfeitas (ex: tema falhou, mas auth ainda OK → logout pode rodar).

**Limitação:** Não diferencia BUG vs BLOCKED vs DRIFT — qualquer falha vira `BugRecord` simplificado. A classificação fina vem na Fase 5.

---

## 3. Estrutura de Diretórios

```
qa-agent-runs/<runId>/
├── plan/
│   ├── global-execution-plan.json     # Plano gerado pela LLM (uma vez)
│   └── scenario-slices.json          # Fatias determinísticas (gerado pelo slicer)
├── state/
│   ├── current-state.json             # Estado estruturado do último cenário
│   ├── runtime-memory.md             # Memória textual para BM25/LLM
│   ├── storage-state-initial.json     # StorageState do início da run
│   ├── storage-state-after-scenario-01.json
│   └── storage-state-after-scenario-02.json
├── evidence/
│   ├── videos/
│   │   ├── scenario-01-login.webm
│   │   ├── scenario-02-theme.webm
│   │   └── scenario-03-logout.webm
│   ├── screenshots/
│   │   ├── scenario-01-start.png
│   │   └── scenario-01-end.png
│   └── traces/
│       └── scenario-01-trace.zip
├── bugs/
│   └── BUG-001.json                   # Bug estruturado (somente quando classification.type === BUG)
├── reports/
│   ├── execution-report.md
│   └── pr-report.md
├── run.json                           # Resultado completo da run (já existe)
├── metrics.json                       # Métricas (já existe)
└── demand-context.json                # Demanda (já existe)
```

> **Nota:** `qa-agent-runs/<runId>/` já é o diretório raiz da run. As novas subpastas são adições dentro dele. Não cria segundo diretório (`.agent-qa/runs/`).

---

## 4. Contrato dos Arquivos

### 4.1 `plan/global-execution-plan.json`

Schema: `ExecutionPlanSchema` (já existe em `@/src/domain/schemas/execution-plan.schema.ts`).

Persistido tal qual gerado pela LLM. Contém `steps[]` onde cada step tem `scenarioId` (obrigatório após Fase 1 — o slicer exige ou aplica fallback).

### 4.2 `plan/scenario-slices.json`

Novo schema:

```typescript
const ScenarioSliceSchema = z.object({
  schemaVersion: z.literal('scenario-slices.v1'),
  runId: z.string().min(1),
  generatedAt: z.string().datetime(),
  slices: z.array(z.object({
    scenarioId: z.string().min(1),
    title: z.string().min(1),
    steps: z.array(ExecutionStepSchema),
    preconditions: z.array(PlanConditionSchema).default([]),
    postconditions: z.array(PlanConditionSchema).default([]),
    dependencies: z.array(z.string()).default([]), // scenarioIds que devem rodar antes
  })),
});
```

### 4.3 `state/current-state.json`

Novo schema:

```typescript
const CurrentStateSchema = z.object({
  schemaVersion: z.literal('current-state.v1'),
  runId: z.string().min(1),
  updatedAt: z.string().datetime(),
  lastScenarioId: z.string().min(1),
  lastStepId: z.string().min(1).optional(),
  authenticated: z.boolean().default(false),
  currentUrl: z.string().optional(),
  theme: z.string().optional(),
  storageStatePath: z.string().optional(), // path relativo ao run dir
  pageState: z.object({
    title: z.string().optional(),
    isLoading: z.boolean().default(false),
    accountMenuOpen: z.boolean().default(false),
  }).optional(),
  flags: z.record(z.boolean()).default({}),
  stateSource: z.enum(['observed', 'inferred', 'restored']).default('observed'),
  confidence: z.number().min(0).max(1).optional(),
  lastFailure: z.object({
    type: z.enum(['BUG', 'BLOCKED', 'DRIFT', 'INCONCLUSIVE']),
    bugId: z.string().min(1),
    scenarioId: z.string().min(1),
    breaksNextScenarios: z.boolean().default(false),
  }).optional(),
});
```

### 4.4 `state/runtime-memory.md`

Formato markdown com seções delimitadas:

```markdown
# Runtime Memory — runId: abc123

## After scenario-login (2026-06-10T13:00:00Z)

- User is authenticated.
- Current URL: https://meshamail.mesha.com.br/
- Inbox is visible.
- Account menu is closed.
- Theme: light.
- Storage state saved at state/storage-state-after-scenario-login.json.
- Video saved at evidence/videos/scenario-01-login.webm.

## After scenario-theme (2026-06-10T13:01:00Z)

- User is authenticated.
- Current URL: https://meshamail.mesha.com.br/
- Account menu was opened and closed.
- Theme changed to dark.
- Storage state saved at state/storage-state-after-scenario-theme.json.
- Video saved at evidence/videos/scenario-02-theme.webm.
```

### 4.5 `state/storage-state-*.json`

Formato nativo do Playwright `storageState()` — já é um JSON padrão. Sem schema adicional.

### 4.6 `bugs/BUG-###.json`

Novo schema:

```typescript
const BugRecordSchema = z.object({
  schemaVersion: z.literal('bug-record.v1'),
  bugId: z.string().min(1),
  scenarioId: z.string().min(1),
  stepId: z.string().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  category: z.enum([
    'ASSERTION_FAILED',
    'NETWORK_ERROR',
    'CONSOLE_ERROR',
    'UI_STATE_MISMATCH',
    'AUTH_STATE_MISMATCH',
    'ROUTE_STATE_MISMATCH',
    'DATA_PERSISTENCE',
    'ACCESSIBILITY',
    'PERFORMANCE',
    'UNKNOWN',
  ]),
  title: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().min(1),
  evidence: z.object({
    screenshotPath: z.string().optional(),
    videoPath: z.string().optional(),
    tracePath: z.string().optional(),
    networkLogPath: z.string().optional(),
    consoleLogPath: z.string().optional(),
  }),
  reproducibility: z.object({
    planPath: z.string(),
    scenarioSlicePath: z.string(),
    storageStatePath: z.string().optional(),
    currentStatePath: z.string().optional(),
  }),
  status: z.literal('OPEN'),
  capturedAt: z.string().datetime(),
});
```

---

## 5. Componentes e Responsabilidades

### 5.1 `ScenarioPlanSlicer` (novo)

```typescript
interface ScenarioPlanSlicerInput {
  plan: ExecutionPlan;
  runId: string;
}

interface ScenarioPlanSlicerOutput {
  slices: ScenarioSlice[];
  slicesPath: string; // path do arquivo salvo
}
```

**Regra de fallback para `scenarioId` ausente:**
1. Se step tem `scenarioId`, usar.
2. Se não tem, herdar do `plan.scenarioId` (se existir no plano).
3. Se ainda não tem, usar `scenario-001` para todos os steps sem scenarioId.
4. Cada fallback gera um warning `MISSING_SCENARIO_ID_FALLBACK` no log/slices metadata — o `scenarioId` **não se torna obrigatório** no `ExecutionPlanSchema` nesta fase.

### 5.2 `RuntimeMemoryWriter` (novo)

```typescript
interface RuntimeMemoryWriter {
  append(runDir: string, entry: RuntimeMemoryEntry): Promise<void>;
  read(runDir: string): Promise<string>;
}

interface RuntimeMemoryEntry {
  scenarioId: string;
  timestamp: string;
  observations: string[];
  storageStatePath?: string;
  videoPath?: string;
}
```

### 5.3 `PreconditionValidator` (novo — Fase 4)

```typescript
interface PreconditionValidator {
  validate(
    slice: ScenarioSlice,
    currentState: CurrentState,
    harness: BrowserHarnessPort,
  ): Promise<PreconditionResult>;
}

interface PreconditionResult {
  ok: boolean;
  failedPreconditions?: PlanCondition[];
  recoveryActions?: QaAction[];
}
```

### 5.4 `DeterministicRecovery` (novo — Fase 4)

```typescript
interface DeterministicRecovery {
  execute(
    failedPreconditions: PlanCondition[],
    currentState: CurrentState,
    harness: BrowserHarnessPort,
  ): Promise<RecoveryResult>;
}
```

**Regras de recovery:**
- `auth_state` falhou → recarregar `storageState` + `navigate(baseUrl)`.
- `route_state` falhou → `navigate(expectedRoute)`.
- `ui_state` falhou → `capture()` + comparar com `current-state.json`.

### 5.5 `PlaywrightHarness` (modificado — Fase 3)

Novos métodos na interface `BrowserHarnessPort`:

```typescript
interface BrowserHarnessPort {
  // ... métodos existentes
  createContextForScenario?(config: RunConfig, storageStatePath?: string): Promise<void>;
  closeScenarioContext?(): Promise<void>;
  saveVideoForScenario?(runDir: string, scenarioId: string): Promise<string>;
}
```

### 5.6 `MemorySearchService` (modificado — Fase 2)

Carrega `runtime-memory.md` junto com `memory.md` na consulta BM25:

```typescript
// antes: apenas memory.md
// depois: memory.md + qa-agent-runs/<runId>/state/runtime-memory.md
// prioridade: runtime-memory.md vence memory.md quando há overlap
```

### 5.7 `FailureClassifierService` (novo — Fase 5)

```typescript
interface FailureClassifierService {
  classify(
    failure: FailureEvidence,
    currentState: CurrentState,
  ): Promise<FailureClassification>;
}

interface FailureEvidence {
  failedCondition: PlanCondition;
  screenshotPath?: string;
  domSnapshot?: string;
  url: string;
  networkErrors: string[];
  consoleErrors: string[];
}

interface FailureClassification {
  type: 'BUG' | 'BLOCKED' | 'DRIFT' | 'INCONCLUSIVE';
  confidence: number; // 0–1
  reason: string;
  useLLM: boolean;    // true se evidência é ambígua e precisa de LLM
}
```

**Regras determinísticas (sem LLM):**
- `network_state` expected `no_5xx`, actual `500` → `BUG` (NETWORK_ERROR).
- `auth_state` expected `authenticated`, actual `anonymous` após login → `BUG` (AUTH_STATE_MISMATCH).
- Elemento não encontrado + Explorer achou alternativa → `DRIFT`.
- Elemento não encontrado + Explorer não achou → `BLOCKED`.
- Página não carregou + timeout → `BLOCKED`.

**LLM só entra quando `useLLM: true`** (ex: URL mudou para `/dashboard` inesperado — drift ou bug?).

### 5.8 `BugRecordBuilder` (novo — Fase 5)

```typescript
interface BugRecordBuilder {
  // Só gera BugRecord quando classification.type === 'BUG'.
  // BLOCKED, DRIFT, INCONCLUSIVE vão para run.json/report/current-state, não para bugs/BUG-###.json.
  build(
    classification: FailureClassification,
    evidence: FailureEvidence,
    slice: ScenarioSlice,
    runDir: string,
  ): BugRecord | undefined;
}
```

### 5.9 `ScenarioContinuationPolicy` (novo — Fase 5)

```typescript
interface ScenarioContinuationPolicy {
  decide(
    currentState: CurrentState,
    nextSlices: ScenarioSlice[],
  ): ScenarioContinuationResult;
}

interface ScenarioContinuationResult {
  action: 'CONTINUE' | 'BLOCK_DEPENDENTS' | 'ABORT_RUN';
  blockedScenarioIds?: string[];
  reason: string;
}
```

**Regras:**
- Falha quebra `precondition` do próximo cenário → `BLOCK_DEPENDENTS`.
- Falha é `CRITICAL` + não há preconditions alternativas → `ABORT_RUN`.
- Falha não afeta próximos cenários → `CONTINUE`.

### 5.10 `BugArtifactWriter` (novo — Fase 5)

```typescript
interface BugArtifactWriter {
  writeBug(runDir: string, bug: BugRecord): Promise<string>; // retorna path do BUG-###.json
  updateRuntimeMemory(runDir: string, bug: BugRecord): Promise<void>;
  updateCurrentState(runDir: string, bug: BugRecord, breaksNext: boolean): Promise<void>;
}
```

---

## 6. Fluxo de Dados

```
┌─────────────────────────────────────────────────────────────┐
│                     RunAgentUseCase                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  1. LLM gera ExecutionPlan (global, uma vez)                │
│  → salva em plan/global-execution-plan.json                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2. ScenarioPlanSlicer fatia por scenarioId                 │
│  → salva em plan/scenario-slices.json                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│  3. Para cada slice (cenário):                                │
│                                                               │
│  a. Cria BrowserContext (Fase 3) ou reusa (Fase 1-2)          │
│  b. Carrega storageState anterior (exceto cenário 1)          │
│  c. Lê current-state.json                                     │
│  d. PreconditionValidator.check() (Fase 4)                    │
│       ├─ pass → executa slice com PlanExecutorService         │
│       └─ fail → DeterministicRecovery (Fase 4)                │
│             ├─ recover ok → executa slice                     │
│             └─ recover fail → LLM replan (só esta fatia)      │
│  e. Executa slice                                             │
│  f. Valida postconditions (Fase 5/MVP)                        │
│       ├─ pass → salva video/storageState/current-state        │
│       └─ fail → captura evidence + classifica (Fase 5)        │
│             ├─ BUG → registra BugRecord, decide continuação   │
│             ├─ DRIFT → tenta replan (Fase 4)                  │
│             ├─ BLOCKED → marca cenário BLOCKED                │
│             └─ INCONCLUSIVE → retry ou marca BLOCKED          │
│  g. Salva video → evidence/videos/scenario-N.webm             │
│  h. Salva storageState → state/storage-state-after-N.json     │
│  i. Atualiza current-state.json                               │
│  j. Append em runtime-memory.md                               │
│  k. Fecha contexto (Fase 3)                                   │
└───────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  4. ScenarioContinuationPolicy decide próximo passo:        │
│     - CONTINUE → próximo cenário                            │
│     - BLOCK_DEPENDENTS → marca dependentes BLOCKED          │
│     - ABORT_RUN → finaliza                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Finaliza run → relatórios + métricas + bugs/            │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Regras de Execução

1. **Plano global é gerado uma vez por run.** Nunca mais de uma vez, exceto replan sob demanda.
2. **`ExecutionStep` com `scenarioId` ausente é normalizado pelo slicer.** O slicer aplica fallback determinístico e registra warning `MISSING_SCENARIO_ID_FALLBACK`. O campo **não se torna obrigatório** nesta fase.
3. **Cenários rodam sequencialmente.** Dependências (`dependsOn`) são resolvidas antes da execução da fatia.
4. **Storage state migra para `qa-agent-runs/<runId>/state/`.** O arquivo `meshamail-auth.json` na raiz do projeto é obsoleto; usado apenas como legacy/fallback.
5. **Vídeo por cenário é real, não simulado.** Playwright grava um vídeo por `BrowserContext`; cada cenário tem seu próprio contexto (Fase 3).
6. **LLM só entra em replan.** Se preconditions passam e recovery funciona, nenhuma chamada LLM adicional.
7. **Runtime memory é append-only.** Nunca sobrescreve; cada cenário adiciona uma seção nova.
8. **Current state é overwrite.** Sempre reflete o estado do último cenário executado.

---

## 8. Migração do storageState existente

Hoje `meshamail-auth.json` fica na raiz do projeto. Durante a implementação:

- Fase 1-2: `storageState` continua na raiz (sem mudança no harness).
- Fase 3: `storageState` passa a ser salvo em `qa-agent-runs/<runId>/state/storage-state-*.json`.
- `ssoRedirect.storageStatePath` na config pode ser relativo ao run dir ou absoluto.
- Para backward compatibility: se `storageStatePath` apontar para raiz, copiar para `state/` no início da run.

---

## 9. Checklist de Revisão

Antes de iniciar implementação, verificar:

- [ ] `ScenarioPlanSlicer` normaliza steps sem `scenarioId` com fallback determinístico e warning `MISSING_SCENARIO_ID_FALLBACK`.
- [ ] `RunDirectoryManager` cria `plan/`, `state/`, `evidence/`, `reports/`.
- [ ] `PlaywrightHarness` pode ser estendido com `createContextForScenario` sem breaking change.
- [ ] `MemorySearchService` aceita múltiplos arquivos de entrada.
- [ ] `PlanExecutorService` aceita sub-conjunto de `ExecutionPlan` (fatia) sem recriar plano.
- [ ] `FailureClassifierService` classifica determinístico sem LLM para casos claros (network 5xx, auth fail, etc.).
- [ ] `BugRecordBuilder` gera `BugRecord` **somente** quando `classification.type === 'BUG'`; BLOCKED/DRIFT/INCONCLUSIVE vão para run.json/report/current-state.
- [ ] `ScenarioContinuationPolicy` decide `CONTINUE | BLOCK_DEPENDENTS | ABORT_RUN` com base em preconditions.
- [ ] `BugArtifactWriter` persiste `bugs/BUG-###.json` e atualiza `runtime-memory.md` / `current-state.json`.

---

## 10. Referências

- Deep Agents overview (LangChain): planejamento detalhado + filesystem para context management.
- Deep Agents memory (LangChain): memória como arquivos com backends controláveis.
- `ExecutionPlanSchema`: `@/src/domain/schemas/execution-plan.schema.ts`
- `RunDirectoryManager`: `@/src/infra/persistence/run-directory.manager.ts`
- `PlaywrightHarness`: `@/src/infra/playwright/playwright-harness.ts`
