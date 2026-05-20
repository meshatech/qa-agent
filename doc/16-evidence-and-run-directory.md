# 16 — Evidence + Run Directory

## Estrutura de diretórios

```txt
qa-agent-runs/
  2026-05-19_15-30-22__<runId-short>/
    run.json                     # metadados da run (QaRun serializado)
    config.json                  # RunConfig sanitizado (sem credenciais)
    demand.md
    generated-scenarios.md
    execution-plan.json          # cenários + tasks planejados
    execution-log.json           # log step-a-step
    execution-report.md          # relatório final humano
    run-data.json                # RunDataStore final
    metrics.json                 # QaRunMetrics

    scenarios/
      cadastro-produto-valido/
        scenario.json
        steps/
          S0001.json
          S0002.json
          ...

    bugs/
      BUG-001/
        bug.json
        bug-report.md
        screenshot.png
        video.webm
        trace.zip
        console.log
        network.json
        dom-snapshot.html
        observation.json         # ScreenObservation no momento do erro

    artifacts/
      screenshots/
      videos/
      traces/
      logs/
        playwright-debug.log
        agent.log
```

## RunDirectoryManager

```ts
export interface RunDirectoryManager {
  createRunDir(input: { startedAt: Date; runId: string }): Promise<string>;
  scenarioDir(scenarioId: string): string;
  bugDir(bugId: string): string;
  stepFile(scenarioId: string, stepId: string): string;
  artifactDir(type: 'screenshots' | 'videos' | 'traces' | 'logs'): string;
}
```

Convenção do nome:

```txt
<ISO_DATE>__<runId-first-8>
ex: 2026-05-19_15-30-22__2f8e1c0a
```

## EvidenceBundle

```ts
export interface EvidenceBundle {
  bugId: string;
  paths: {
    screenshot?: string;
    video?: string;
    trace?: string;
    consoleLog?: string;
    networkLog?: string;
    domSnapshot?: string;
    observation: string;
    bugReportMd: string;
    bugJson: string;
  };
  capturedAt: string;
}
```

## EvidenceHarness

```ts
export interface EvidenceHarness {
  record(input: RecordEvidenceInput): Promise<EvidenceBundle>;
}

export interface RecordEvidenceInput {
  runId: string;
  scenarioId: string;
  taskId: string;
  stepId: string;
  observation: ScreenObservation;
  classification: BugClassification;
  expected?: string;
  actual?: string;
  rawError?: unknown;
}
```

## Quando salvar evidência

```txt
- bug real classificado (isBug=true)
- RECOVERY_EXHAUSTED
- AbortScenario com motivo crítico
- Crash inesperado do Harness
```

**Não** salvar evidência completa em sinais classificados como ruído. Salvar apenas no `execution-log.json` para auditoria.

## execution-log.json (formato)

Streamável, NDJSON-friendly se preferir.

```json
{
  "runId": "2f8e1c0a-...",
  "version": "log.v1",
  "entries": [
    {
      "stepId": "S0001",
      "scenarioId": "cadastro-produto-valido",
      "taskId": "T001",
      "observationId": "obs_20260519_173122_ab12",
      "ts": "2026-05-19T17:31:22Z",
      "kind": "STEP",
      "thoughtSummary": "preencher Nome",
      "action": { "type": "fill", "targetElementId": "el_001", "value": "{{uniqueName:productName:Produto Teste}}" },
      "resolvedAction": { "type": "fill", "targetElementId": "el_001", "value": "Produto Teste 20260519173122-a82f" },
      "expected": { "type": "field_value_contains", "targetElementId": "el_001", "value": "{{ref:productName}}" },
      "boundExpected": {
        "type": "field_value_contains",
        "target": {
          "originalElementId": "el_001",
          "observationId": "obs_20260519_173122_ab12",
          "locator": { "strategy": "label", "text": "Nome" },
          "humanName": "Nome"
        },
        "value": "Produto Teste 20260519173122-a82f"
      },
      "quiescence": { "stable": true, "reason": "NETWORK_AND_DOM_IDLE", "elapsedMs": 312 },
      "validation": { "ok": true, "durationMs": 28 },
      "confidence": 0.91,
      "status": "VALIDATED"
    },
    {
      "kind": "RECOVERY",
      "stepId": "S0002",
      "attempts": [
        { "actionType": "click", "result": "timeout", "ts": "..." },
        { "actionType": "press(Escape)", "result": "recovered", "ts": "..." }
      ]
    },
    {
      "kind": "BUG",
      "bugId": "BUG-001",
      "stepId": "S0003",
      "classification": { "isBug": true, "severity": "HIGH", "category": "APP_FAULT", "reason": "POST /api/produtos 500" },
      "evidenceBundle": "bugs/BUG-001/"
    }
  ]
}
```

## bug-report.md (template)

````md
# {{bugId}} — {{title}}

## Severidade
{{severity}}

## Categoria
{{category}}

## Cenário
{{scenarioId}}

## Task
{{taskId}} — {{taskTitle}}

## Step
{{stepId}}

## URL
{{url}}

## Resultado esperado
{{expected}}

## Resultado obtido
{{actual}}

## Sinal
{{signalType}} — {{classification.reason}}

## Evidências
- Screenshot: ./screenshot.png
- Vídeo: ./video.webm
- Trace: ./trace.zip
- Console log: ./console.log
- Network log: ./network.json
- DOM snapshot: ./dom-snapshot.html
- Observation: ./observation.json

## Logs relevantes

```txt
{{relevantLogs}}
```

## Tentativas anteriores

{{attemptsTable}}

## Possível causa

{{maybeCause}}

## Metadados

- runId: {{runId}}
- timestamp: {{timestamp}}
- agent version: {{agentVersion}}
- prompt version: {{promptVersion}}
````

## execution-report.md (template)

````md
# Execution Report — Run {{runId}}

## Resumo

- Demanda: {{demand.title}}
- Início: {{startedAt}}
- Fim: {{finishedAt}}
- Status: {{status}}
- Duração: {{durationMs}} ms

## Métricas

| Métrica | Valor |
|---------|-------|
| Cenários | {{totalScenarios}} |
| Passaram | {{passedScenarios}} |
| Falharam | {{failedScenarios}} |
| Bloqueados | {{blockedScenarios}} |
| Tasks total | {{totalTasks}} |
| Bugs reais | {{totalBugs}} |
| Chamadas LLM | {{llmCalls}} |

## Cenários

{{#each scenarios}}
### {{title}} — {{status}}

- Tasks passadas: {{passed}}
- Tasks falhadas: {{failed}}
- Bugs: {{bugCount}}
{{/each}}

## Bugs encontrados

{{#each bugs}}
- [{{bugId}}]({{path}}) — {{severity}} — {{title}}
{{/each}}

## Arquivos importantes

- execution-log.json
- run-data.json
- metrics.json
````

## Política de retenção

```txt
- screenshots de bug: sempre manter
- vídeos: comprimir após N dias se config.retention.compressAfterDays
- traces: pesados, deletar após N dias se config permitir
- run.json + execution-report.md: nunca deletar
```

## Sanitização de evidência

Antes de salvar, mascarar conforme doc 18:

```txt
- credenciais em URL/headers/cookies
- tokens JWT em network logs
- valores de campos password
- emails reais se config.privacy.maskEmails=true
```

## Schema version

```txt
RUN_DIR_VERSION = "run.v1"
LOG_VERSION = "log.v1"
```
