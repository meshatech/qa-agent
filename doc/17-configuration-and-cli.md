# 17 — Configuration + CLI

## RunConfig (schema)

```ts
export const RunConfigSchema = z.object({
  // alvo
  baseUrl: z.string().url(),
  appDomains: z.array(z.string()).min(1),       // ex: ["app.example.com"]

  // demanda
  demand: QaDemandSchema,

  // navegador
  browser: z.object({
    engine: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
    headed: z.boolean().default(false),
    viewport: z.object({ width: z.number(), height: z.number() }).default({ width: 1280, height: 720 }),
    locale: z.string().default('pt-BR'),
    timezone: z.string().default('America/Sao_Paulo'),
    slowMoMs: z.number().int().nonnegative().optional(),
  }).default({}),

  // autenticação
  auth: z.union([
    z.object({ kind: z.literal('none') }),
    z.object({
      kind: z.literal('storageState'),
      path: z.string(),                          // arquivo JSON Playwright
    }),
    z.object({
      kind: z.literal('formLogin'),
      loginUrl: z.string(),
      usernameSelector: LocatorDescriptorSchema,
      passwordSelector: LocatorDescriptorSchema,
      submitSelector: LocatorDescriptorSchema,
      usernameEnv: z.string(),                   // nome da env var
      passwordEnv: z.string(),
      successWhen: z.object({
        urlContains: z.string().optional(),
        textVisible: z.string().optional(),
      }),
    }),
  ]).default({ kind: 'none' }),

  // timeouts
  timeouts: z.object({
    actionMs: z.number().int().positive().default(15000),
    navigationMs: z.number().int().positive().default(30000),
    quiescenceMs: z.number().int().positive().default(3000),
    scenarioMs: z.number().int().positive().default(180000),
    runMs: z.number().int().positive().default(1800000),
  }).default({}),

  // recovery
  recovery: z.object({
    maxAttemptsPerTask: z.number().int().positive().default(3),
    maxFallbacksPerStep: z.number().int().positive().default(1),
    maxEmergencyActionsPerScenario: z.number().int().positive().default(5),
  }).default({}),

  // LLM
  llm: z.object({
    provider: z.enum(['openai', 'anthropic', 'azure', 'local']),
    model: z.string(),
    temperature: z.number().min(0).max(1).default(0),
    maxTokens: z.number().int().positive().default(2048),
    maxSchemaRetries: z.number().int().nonnegative().default(2),
    apiKeyEnv: z.string(),
    promptVersion: z.string().default('v1'),
  }),

  // rotas permitidas
  allowedRoutes: z.array(z.string()).optional(),

  // bug classifier
  classifier: z.object({
    knownNoiseRegexes: z.array(z.string()).optional(),
    knownThirdPartyDomains: z.array(z.string()).optional(),
  }).optional(),

  // privacy (ver doc 18)
  privacy: z.object({
    maskEmails: z.boolean().default(false),
    maskJwt: z.boolean().default(true),
    maskCookies: z.boolean().default(true),
    additionalRegexes: z.array(z.string()).optional(),
  }).default({}),

  // output
  output: z.object({
    runsDir: z.string().default('./qa-agent-runs'),
    keepVideoOnPass: z.boolean().default(false),
    keepTraceOnPass: z.boolean().default(false),
  }).default({}),

  // meta
  agentVersion: z.string().default('0.1.0'),
});

export type RunConfig = z.infer<typeof RunConfigSchema>;
```

## Arquivo de config

Aceita JSON, YAML ou TS:

```txt
agent-qa.config.json
agent-qa.config.yaml
agent-qa.config.ts        ← exporta default
```

### Exemplo JSON

```json
{
  "baseUrl": "https://app.example.com",
  "appDomains": ["app.example.com", "api.example.com"],
  "demand": {
    "id": "DEM-001",
    "title": "Cadastro de produto",
    "description": "Validar fluxo de criação de produto"
  },
  "auth": {
    "kind": "formLogin",
    "loginUrl": "/login",
    "usernameSelector": { "strategy": "label", "text": "E-mail" },
    "passwordSelector": { "strategy": "label", "text": "Senha" },
    "submitSelector": { "strategy": "role", "role": "button", "name": "Entrar" },
    "usernameEnv": "QA_USERNAME",
    "passwordEnv": "QA_PASSWORD",
    "successWhen": { "urlContains": "/dashboard" }
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "maxSchemaRetries": 2,
    "apiKeyEnv": "OPENAI_API_KEY"
  }
}
```

## LLM provider adapter

Na v0.1, `llm.provider` é resolvido por `LlmModule` para uma implementação de `DecisionProvider`.

```txt
openai → LangChainDecisionProvider + @langchain/openai
anthropic/azure/local → previstos, mas não obrigatórios no MVP inicial
```

Regra: nenhum módulo fora de `LlmModule` importa LangChain diretamente. O Orchestrator depende apenas da interface `DecisionProvider` definida no doc 20.

## Variáveis de ambiente

| Nome | Uso |
|------|-----|
| Valor de `llm.apiKeyEnv` | API key da LLM |
| Valor de `auth.usernameEnv` | Username de login |
| Valor de `auth.passwordEnv` | Password de login |
| `QA_LOG_LEVEL` | debug/info/warn/error |
| `QA_HEADED` | sobrescreve `browser.headed` |
| `CLICKUP_TOKEN` | API token ClickUp (preflight + leitor HTTP) |
| `CLICKUP_TEAM_ID` | Team ID para custom IDs (`PRJ-xxxxx`) na API ClickUp |
| `CLICKUP_TASK_ID` | **Deprecado** — fallback temporário para `qa-agent run` local; preferir `config.clickup.taskId` |
| `CLICKUP_CUSTOM_ID_PATTERN` | **Deprecado** — fallback regex para extrair custom ID do PR; preferir `config.clickup.customIdPattern` |
| `GITHUB_TOKEN` / `GH_TOKEN` | Token GitHub Actions (comentário PR — warning se ausente) |

Credenciais **nunca** ficam no arquivo de config. Sempre via env.

## CLI

Comando:

```txt
qa-agent run --config ./agent-qa.config.json [flags]
qa-agent preflight --output-dir ./.agent-qa/pipeline
qa-agent read-pr-context --output-dir ./.agent-qa/pipeline
qa-agent pipeline prepare --output-dir ./.agent-qa/pipeline
qa-agent pipeline correlate --output-dir ./.agent-qa/pipeline
qa-agent inspect --runId <id>
qa-agent report --runId <id> --format md|json
qa-agent validate-config --config ./agent-qa.config.json
```

`read-pr-context` executa `git diff origin/<base>...HEAD` com limite de **50MB** de stdout. Se o diff exceder esse buffer, o comando falha com `GIT_DIFF_FAILED` e mensagem explícita (`Git diff output exceeded 50MB buffer limit`).

`pipeline prepare` executa **preflight** (gate obrigatório) e só então **read-pr-context**, gravando `preflight-report.json` e `pr-diff-context.json` no mesmo `--output-dir`. Preflight `BLOCKED` interrompe antes do diff (exit code 6).

`pipeline correlate` (PRJ-11392) lê `pr-diff-context.json`, busca demanda ClickUp via `pullRequest.clickUpTaskId` + `CLICKUP_TOKEN`, consulta memória BM25 (`.agent-qa/memory.md`) e grava `demand-context.json`, `required-scenarios.json` e `correlation-report.md`. Status `BLOCKED` quando entrada incompleta (sem task ID, token, critérios de aceite ou sinal de diff) — exit code 6. Memória vazia não bloqueia (warning no artefato).

Pré-requisito: `pipeline prepare` no mesmo `--output-dir`.

### ClickUp task ID a partir do PR (PRJ-11552)

Convenção Sprint Labs: incluir custom ID ClickUp no **título** do PR, ex.: `PRJ-11552 — descrição curta`. Se ausente no título, o agente tenta extrair do **corpo** do PR (`pull_request.body` em `GITHUB_EVENT_PATH`).

- Padrão default: `PRJ-\d+` (override: `config.clickup.customIdPattern` > `CLICKUP_CUSTOM_ID_PATTERN` env deprecada)
- Pipeline (preflight + prepare): `clickUpTaskId` extraído do evento GitHub (`GITHUB_EVENT_PATH`)
- Preflight local sem GHA: check `clickupTaskId` **skipped** (`WARN` no report; não bloqueia sozinho)
- `qa-agent run` local: `config.clickup.taskId` (fallback deprecado `CLICKUP_TASK_ID` env com warning)
- Saída: campo `pullRequest.clickUpTaskId` em `pr-diff-context.json` (opcional no schema)
- Ausência no PR (modo pipeline): preflight `BLOCKED`; `read-pr-context` isolado não falha por ID ausente (omite o campo)

### Flags principais

| Flag | Tipo | Default | Efeito |
|------|------|---------|--------|
| `--config <path>` | string | `./agent-qa.config.json` | caminho do config |
| `--headed` | bool | false | overrride headed |
| `--demand <path>` | string | — | usa arquivo md como `demand.description` |
| `--scenario <id>` | string | — | roda só um cenário |
| `--max-scenarios <n>` | int | — | limita N cenários |
| `--dry-run` | bool | false | gera plano sem executar |
| `--output-dir <path>` | string | config | sobrescreve `output.runsDir` |
| `--seed <n>` | int | — | seed para data harness |
| `--verbose` | bool | false | log verboso |

### Códigos de saída

```txt
0 — run completou sem bugs
1 — run completou com bugs (HIGH ou CRITICAL)
2 — erro de configuração
3 — erro fatal do harness (não conseguiu rodar)
4 — abortado por timeout total
5 — onboarding bloqueado (smoke/readiness)
6 — pipeline preflight bloqueado (check obrigatório falhou; `preflight-report.json` gerado)
```

## Entrypoint TypeScript

```ts
import { runQaAgent } from 'agent-qa';

const result = await runQaAgent({
  configPath: './agent-qa.config.json',
});

console.log(result.metrics);
```

## Validação ao iniciar

Antes de abrir navegador:

```txt
1. Parsear config com Zod
2. Resolver env vars (apiKeyEnv, usernameEnv, passwordEnv)
3. Falhar fast se faltar env crítica
4. Pingar baseUrl (HEAD)
5. Criar diretório da run
6. Persistir config sanitizado em config.json
```

## Autenticação

### Storage state (recomendado)

```ts
const context = await browser.newContext({
  storageState: config.auth.path,
});
```

Storage state pode ser gerado por script separado `qa-agent capture-auth`.

### Form login

```ts
async function loginViaForm(page: Page, auth: FormLoginAuth, env: NodeJS.ProcessEnv) {
  await page.goto(auth.loginUrl);
  await resolveToLocator(page, auth.usernameSelector).fill(env[auth.usernameEnv]!);
  await resolveToLocator(page, auth.passwordSelector).fill(env[auth.passwordEnv]!);
  await resolveToLocator(page, auth.submitSelector).click();

  if (auth.successWhen.urlContains) {
    await page.waitForURL(new RegExp(escapeRegExp(auth.successWhen.urlContains)));
  }
  if (auth.successWhen.textVisible) {
    await page.getByText(auth.successWhen.textVisible).waitFor();
  }
}
```

## Reset entre cenários

```txt
- novo BrowserContext por cenário (isola cookies/storage/cache)
- reaplicar storageState se config.auth.kind === 'storageState'
- resetar RunDataStore? NÃO. RunDataStore é por run, não por cenário.
  Se cenário precisa de isolamento de dados, gerar nova chave.
```

## Concurrency

MVP roda **sequencial** (um cenário por vez). Paralelismo fica para v0.2:

```txt
- LLM rate limit
- Coleta de evidência precisa ser serial
- Logs unificados ficam difíceis com paralelismo
```
