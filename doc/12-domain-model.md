# 12 — Domain Model

## Entidades raiz

```txt
QaRun
  └── QaDemand
  └── QaScenario[]
        └── QaTask[]
              └── QaStep[]   (gerado durante execução)
```

## QaRun

```ts
export interface QaRun {
  runId: string;                  // uuid v4
  startedAt: string;              // ISO 8601
  finishedAt?: string;
  status: QaRunStatus;
  config: RunConfig;              // ver doc 17
  demand: QaDemand;
  scenarios: QaScenario[];
  metrics?: QaRunMetrics;
}

export type QaRunStatus =
  | 'INITIALIZING'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'PARTIAL'
  | 'ABORTED';
```

## QaDemand

Demanda funcional bruta do usuário.

```ts
export interface QaDemand {
  id: string;
  title: string;
  description: string;            // markdown, livre
  acceptanceCriteria?: string[];  // opcional
  scope?: {
    routes?: string[];            // limita áreas testáveis
    features?: string[];
  };
}
```

Exemplo:

```json
{
  "id": "DEM-001",
  "title": "Cadastro de produto",
  "description": "Validar fluxo de criação de produto no painel admin",
  "acceptanceCriteria": [
    "Produto deve aparecer na listagem após criação",
    "Campos obrigatórios devem bloquear submit"
  ],
  "scope": { "routes": ["/produtos/*"] }
}
```

## QaScenario

```ts
export interface QaScenario {
  id: string;                     // ex: "cadastro-produto-valido"
  title: string;
  intent: ScenarioIntent;
  preconditions?: string[];
  tasks: QaTask[];
  status: QaScenarioStatus;       // ver doc 08
}

export type ScenarioIntent =
  | 'POSITIVE'                    // happy path
  | 'NEGATIVE'                    // erro esperado
  | 'EDGE'                        // borda / limite
  | 'EXPLORATORY';                // exploratório
```

## QaTask

Intenção de teste. **Não** carrega seletor.

```ts
export interface QaTask {
  id: string;                     // ex: "T003"
  title: string;
  intent: string;                 // "Preencher campo Nome"
  expected: string;               // "Campo Nome deve conter valor digitado"
  type: QaTaskType;
  status: QaTaskStatus;           // ver doc 08
  attempts: AttemptRecord[];
  dependsOn?: string[];           // ids de outras tasks
}

export type QaTaskType =
  | 'NAVIGATION'
  | 'INPUT'
  | 'ACTION'
  | 'ASSERTION'
  | 'COMPOUND';
```

## QaStep

Step = ciclo Observe→Decide→Act→Validate concreto. **Gerado** durante execução, não pré-definido.

```ts
export interface QaStep {
  stepId: string;
  taskId: string;
  observationId: string;
  thoughtSummary: string;
  action: QaAction;               // ver doc 14
  resolvedAction: QaAction;       // após DataHarness
  expectedAfterAction: ExpectedAfterAction;
  boundExpectedAfterAction?: BoundExpectedAfterAction;
  fallbackAction?: QaAction;
  confidence: number;
  status: QaStepStatus;           // ver doc 08
  startedAt: string;
  finishedAt?: string;
  quiescence?: QuiescenceResult;
  validation?: AssertionResult;
  error?: QaRuntimeError;
}
```

## AttemptRecord

Memória curta de tentativas por task.

```ts
export interface AttemptRecord {
  attemptId: string;
  stepId: string;
  actionType: string;
  target?: string;                // nome humano, não seletor
  resultCode: 'PASSED' | 'FAILED' | 'TIMEOUT' | 'BLOCKED' | 'RECOVERED';
  url: string;
  timestamp: string;
}
```

## QaRunMetrics

```ts
export interface QaRunMetrics {
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  blockedScenarios: number;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  totalSteps: number;
  totalBugs: number;
  totalDurationMs: number;
  llmCalls: number;
  llmTokensIn?: number;
  llmTokensOut?: number;
}
```

## Relação com Bug

Bug é entidade transversal, salva em `bugs/BUG-NNN/` (doc 16):

```ts
export interface QaBug {
  bugId: string;                  // "BUG-001"
  runId: string;
  scenarioId: string;
  taskId: string;
  stepId: string;
  signalType: BugSignalType;      // ver doc 08
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  expected?: string;
  actual?: string;
  url: string;
  timestamp: string;
  evidence: EvidenceBundle;       // ver doc 16
}
```

## Validação com Zod

Todo schema acima tem versão Zod em runtime:

```ts
export const QaDemandSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).optional(),
  scope: z.object({
    routes: z.array(z.string()).optional(),
    features: z.array(z.string()).optional(),
  }).optional(),
});

export type QaDemand = z.infer<typeof QaDemandSchema>;
```

Padrão: schema Zod é a **fonte da verdade**, tipos TS derivam de `z.infer`.

## Convenção de IDs

| Entidade | Formato | Exemplo |
|----------|---------|---------|
| `runId` | uuid v4 | `2f8e...` |
| `scenarioId` | kebab-case | `cadastro-produto-valido` |
| `taskId` | `T<NNN>` | `T003` |
| `stepId` | `S<NNN>` (por run) | `S0042` |
| `observationId` | `obs_<ts>_<short>` | `obs_20260519_173122_ab12` |
| `bugId` | `BUG-<NNN>` | `BUG-007` |
| `el_id` | `el_<NNN>` (por observação) | `el_001` |
