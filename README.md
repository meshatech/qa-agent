# Agent QA

Runtime de QA guiado por LLM para executar fluxos web via Playwright, com observacao da tela, decisao de proxima acao, validacao, recovery e geracao de evidencias.

## Estado Atual

- Versao atual: `0.1.0`
- Release runtime: `v0.2-stable` documentada em [`doc/release-notes/v0.2-stable.md`](doc/release-notes/v0.2-stable.md)
- Stack: `TypeScript`, `NestJS`, `Playwright`, `Zod`, `Commander`
- Interface principal: CLI `qa-agent`
- Providers LLM disponiveis hoje: `fake`, `groq`, `openai`
- Engines de browser suportadas: `chromium`, `firefox`, `webkit`
- Execucao: sequencial, um cenario por vez
- **v2 simplificado:** runtime enxugado. Removidos `ExecutionMonitorService`, `DeepThinkService`, `RedisPlanCacheAdapter`, `FilePlanCacheAdapter`. Arquivado `ProjectGraphService` (experimental/). Isolada rota `FULL_REACTIVE` em `ReactiveRunnerService`. Ver [`docs/V2-SIMPLIFICATION-PLAN.md`](docs/V2-SIMPLIFICATION-PLAN.md).

O projeto ja entrega hoje:

- parse e validacao de config com `JSON`, `YAML` e `TS/JS`
- preflight de runtime antes da run com validacao de envs e `HEAD` no `baseUrl` (`validate-config`)
- preflight de pipeline CI com checks ClickUp/GitHub/git e `preflight-report.json` (`preflight`)
- loop `observe -> decide -> act -> validate -> recover`
- protecao contra `stale observation`
- data harness para placeholders dinamicos
- recovery com fallback e acoes de emergencia
- diretorio de run com `run.json`, `execution-log.json`, `metrics.json`, `execution-report.md`
- pasta de bugs com screenshot, DOM, network, trace, video e `bug-report.md`
- sanitizacao basica de dados sensiveis antes de persistir

Limites conhecidos do estado atual:

- o contrato de providers ainda reflete o codigo atual, nao a lista mais ampla prevista nas specs
- `inspect` e `report` usam `--runs-dir` e `--run-id`
- `report` suporta `--format md|json`; `inspect` retorna `run.json`
- o projeto esta focado no fluxo CLI, nao em SDK publica estavel

## Requisitos

- `Node.js 20+`
- dependencias instaladas com `npm install`
- browsers do Playwright instalados

Instalacao:

```bash
npm install
npx playwright install
```

## Como Rodar

Durante desenvolvimento:

```bash
npm run qa-agent -- validate-config --config ./agent-qa.config.json
npm run qa-agent -- run --config ./agent-qa.config.json
```

Depois de buildar:

```bash
npm run build
node dist/main.js validate-config --config ./agent-qa.config.json
node dist/main.js run --config ./agent-qa.config.json
```

## Configuracao Minima

Exemplo funcional minimo usando o provider `fake`:

```json
{
  "baseUrl": "http://127.0.0.1:4173",
  "appDomains": ["127.0.0.1"],
  "demand": {
    "id": "DEM-001",
    "title": "Fixture smoke",
    "description": "Preencher nome e salvar"
  },
  "llm": {
    "provider": "fake",
    "model": "fake",
    "apiKeyEnv": "GROQ_PROVIDER"
  },
  "output": {
    "runsDir": "./qa-agent-runs"
  }
}
```

Arquivos aceitos:

- `agent-qa.config.json`
- `agent-qa.config.yaml`
- `agent-qa.config.yml`
- `agent-qa.config.ts`
- `agent-qa.config.js`
- `agent-qa.config.mjs`

Campos importantes do config atual:

- `baseUrl`: URL inicial da aplicacao
- `appDomains`: dominios considerados da aplicacao
- `browser.engine`: `chromium`, `firefox` ou `webkit`
- `browser.headed`: abre browser visivel
- `auth.kind`: `none`, `storageState`, `formLogin`
- `llm.provider`: `fake`, `groq`, `openai`
- `timeouts.*`: limites de execucao
- `runtime.maxActionsPerTask`: teto de ciclos por task
- `recovery.maxAttemptsPerTask`: tentativas por task
- `output.keepTraceOnPass`: salva trace da run quando passar
- `output.keepVideoOnPass`: salva video da run quando passar

### Override de baseUrl por PR/preview

Em pipelines onde cada PR sobe em uma URL dinâmica (ex.: `https://pr-<N>.preview.<dominio>`), use variáveis de ambiente em vez de editar o JSON:

| Variável | Efeito |
|----------|--------|
| `QA_AGENT_BASE_URL` | Substitui `config.baseUrl` após o parse Zod |
| `QA_AGENT_PREVIEW_DOMAIN` | Injeta o domínio base (sem prefixo `*.`) em `appDomains` — ex.: `*.preview.meshamail.dev` → `preview.meshamail.dev` |

Exemplo para preview de PR:

```bash
export QA_AGENT_BASE_URL="https://pr-42.preview.meshamail.dev"
export QA_AGENT_PREVIEW_DOMAIN="*.preview.meshamail.dev"
npm run qa-agent -- run --config ./configs/agent-qa.meshamail.config.json
```

Implementação: [`src/application/helpers/apply-base-url-override.ts`](src/application/helpers/apply-base-url-override.ts) (wired em `ValidateConfigUseCase`, `RunAgentUseCase` e use-cases de pipeline).

Configs versionados em `configs/`:

- `configs/agent-qa.fixture.config.json` — smoke local (fixture HTTP)
- `configs/agent-qa.meshamail.config.json` — smoke autenticado MeshaMail (credenciais via `MESHA_EMAIL` / `MESHA_PASSWORD`)

## Providers LLM

Estado atual implementado:

- `fake`: nao exige API key; util para smoke/local
- `groq`: exige `process.env[llm.apiKeyEnv]`
- `openai`: exige `process.env[llm.apiKeyEnv]`

Observacao: mesmo no provider `fake`, o campo `llm` continua obrigatorio no config porque faz parte do schema atual.

## Autenticacao

Modos suportados:

- `none`
- `storageState`
- `formLogin`

Para `formLogin`, o preflight valida se as envs declaradas em `usernameEnv` e `passwordEnv` existem antes de abrir o browser.

Para gerar `storageState` a partir de login por formulario:

```bash
npm run qa-agent -- capture-auth --config ./agent-qa.config.json --output ./storage-state.json
```

### Exemplo Real Com `localhost` E Login

Se sua aplicacao roda localmente e exige login antes do fluxo, voce nao precisa pedir para o agente "descobrir" a credencial no `demand`.

O caminho correto hoje e:

1. descrever o login em `auth`
2. passar a credencial via variaveis de ambiente
3. descrever os passos de teste em `demand.description` ou `demand.acceptanceCriteria`

Exemplo:

```json
{
  "baseUrl": "http://localhost:3000",
  "appDomains": ["localhost"],
  "browser": {
    "engine": "chromium",
    "headed": true
  },
  "auth": {
    "kind": "formLogin",
    "loginUrl": "/login",
    "usernameSelector": { "strategy": "label", "text": "E-mail" },
    "passwordSelector": { "strategy": "label", "text": "Senha" },
    "submitSelector": { "strategy": "role", "role": "button", "name": "Entrar" },
    "usernameEnv": "QA_USERNAME",
    "passwordEnv": "QA_PASSWORD",
    "successWhen": {
      "urlContains": "/dashboard"
    }
  },
  "demand": {
    "id": "DEM-LOGIN-001",
    "title": "Validar criacao de projeto autenticado",
    "description": "Abrir a area autenticada\nIr para a tela de projetos\nCriar um novo projeto\nValidar que o projeto aparece na lista",
    "acceptanceCriteria": [
      "Abrir a area autenticada",
      "Ir para a tela de projetos",
      "Criar um novo projeto",
      "Validar que o projeto aparece na lista"
    ]
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "OPENAI_API_KEY"
  },
  "output": {
    "runsDir": "./qa-agent-runs",
    "keepTraceOnPass": true,
    "keepVideoOnPass": true
  }
}
```

Antes de rodar:

```bash
export QA_USERNAME="seu-login"
export QA_PASSWORD="sua-senha"
export OPENAI_API_KEY="sua-chave"
```

No PowerShell:

```powershell
$env:QA_USERNAME="seu-login"
$env:QA_PASSWORD="sua-senha"
$env:OPENAI_API_KEY="sua-chave"
```

Depois execute:

```bash
npm run qa-agent -- validate-config --config ./agent-qa.config.json
npm run qa-agent -- run --config ./agent-qa.config.json --headed
```

Observacoes importantes:

- o login acontece antes do inicio da run funcional
- usuario e senha nao devem ficar hardcoded no JSON
- o preflight falha se `QA_USERNAME` ou `QA_PASSWORD` nao existirem
- `successWhen.urlContains` ou `successWhen.textVisible` ajudam a confirmar que o login deu certo

### Como Passar Os Passos Para Teste

### Onde O `demand` E Feito

Hoje existem 2 formas reais de definir o `demand`:

1. direto no arquivo de configuracao
2. em um arquivo Markdown passado pela CLI com `--demand`

#### Opcao 1: No proprio config

Voce escreve o bloco `demand` dentro do `agent-qa.config.json`:

```json
{
  "demand": {
    "id": "DEM-002",
    "title": "Cadastro de cliente autenticado",
    "description": "Abrir clientes\nClicar em novo cliente\nPreencher nome e email\nSalvar cadastro\nValidar mensagem de sucesso",
    "acceptanceCriteria": [
      "Abrir clientes",
      "Clicar em novo cliente",
      "Preencher nome e email",
      "Salvar cadastro",
      "Validar mensagem de sucesso"
    ]
  }
}
```

Esse e o jeito mais simples quando o fluxo e curto e voce quer manter tudo no mesmo arquivo.

#### Opcao 2: Em um arquivo `.md`

Se o fluxo for maior, voce pode manter o `demand` fora do JSON e passar pela CLI:

```bash
npm run qa-agent -- run --config ./agent-qa.config.json --demand ./demands/cadastro-cliente.md
```

Exemplo de `cadastro-cliente.md`:

```md
Abrir clientes
Clicar em novo cliente
Preencher nome e email
Salvar cadastro
Validar mensagem de sucesso
```

Importante:

- hoje o `--demand` sobrescreve `demand.description`
- o `id` e o `title` continuam vindo do config
- se voce usar `acceptanceCriteria` no JSON, ele continua existindo no config, mas o texto do Markdown substitui a `description`

Regra pratica:

- fluxo pequeno: use `demand` dentro do config
- fluxo maior ou reutilizavel: use um arquivo `.md` com `--demand`

Hoje, o jeito mais claro de orientar a execucao e escrever o fluxo esperado em:

- `demand.description` usando uma linha por passo
- `demand.acceptanceCriteria` usando uma lista explicita

Na pratica, para um fluxo com login, pense assim:

- `auth` diz como entrar na aplicacao
- `demand` diz o que validar depois que ja estiver autenticado

Exemplo de `demand` bom:

```json
{
  "demand": {
    "id": "DEM-002",
    "title": "Cadastro de cliente autenticado",
    "description": "Abrir clientes\nClicar em novo cliente\nPreencher nome e email\nSalvar cadastro\nValidar mensagem de sucesso",
    "acceptanceCriteria": [
      "Abrir clientes",
      "Clicar em novo cliente",
      "Preencher nome e email",
      "Salvar cadastro",
      "Validar mensagem de sucesso"
    ]
  }
}
```

Dicas para escrever bem esses passos:

- use frases curtas e objetivas
- descreva o resultado esperado, nao o selector tecnico
- se houver pre-condicao de negocio, explicite no texto
- se quiser limitar o escopo, use `scope.routes` e `allowedRoutes`

## Comandos Da CLI

Validar config:

```bash
npm run qa-agent -- validate-config --config ./agent-qa.config.json
```

Preflight de pipeline (CI — ClickUp, GitHub, git, config sem `HEAD`):

```bash
npm run qa-agent -- preflight --output-dir ./.agent-qa/pipeline
```

Emite `preflight-report.json` no diretorio de saida. Exit code `6` quando `status` e `BLOCKED`.

Token GitHub aceito via `GITHUB_TOKEN`, `GH_TOKEN` ou `INPUT_GITHUB_TOKEN`. O campo `tokensMasked` no report indica se a sanitizacao removeu secrets conhecidos; `false` sinaliza possivel vazamento. `AGENT_QA_CONFIG` e resolvido contra `GITHUB_WORKSPACE` (ou cwd). Eventos `pull_request` e `pull_request_target` sao aceitos; PR number pode vir de `GITHUB_REF`, `GITHUB_EVENT_PATH` ou `GITHUB_PR_NUMBER`.

Executar uma run:

```bash
npm run qa-agent -- run --config ./agent-qa.config.json
```

Flags principais de `run`:

- `--headed`
- `--dry-run`
- `--demand <path>`
- `--scenario <id>`
- `--max-scenarios <n>`
- `--seed <n>`
- `--output-dir <path>`
- `--verbose`

Inspecionar a ultima run ou uma run especifica:

```bash
npm run qa-agent -- inspect --runs-dir ./qa-agent-runs
npm run qa-agent -- inspect --runs-dir ./qa-agent-runs --run-id 2026-05-20T01-00-00__abcd1234
```

Gerar relatorio markdown ou JSON:

```bash
npm run qa-agent -- report --runs-dir ./qa-agent-runs --format md
npm run qa-agent -- report --runs-dir ./qa-agent-runs --run-id 2026-05-20T01-00-00__abcd1234 --format json
```

### Exit codes da CLI

| Codigo | Significado |
|--------|-------------|
| `0` | Sucesso |
| `1` | Bugs encontrados na run |
| `2` | Erro de config |
| `3` | Erro fatal do harness |
| `4` | Timeout |
| `5` | Onboarding bloqueado |
| `6` | Preflight de pipeline bloqueado (`qa-agent preflight`) |

## Fluxo Da Run

Em alto nivel, a execucao atual faz:

1. carrega e parseia o config
2. aplica overrides da CLI
3. executa preflight de envs e `HEAD` no `baseUrl`
4. gera plano de cenarios
5. abre o browser e observa a tela
6. **escolhe a rota de execucao** (config `runtime.mode`):
   - **Tools** (`tools.enabled=true`, modo != FULL_REACTIVE): usa `qa.plan.build` + `qa.plan.execute` -> `PlanExecutorService`
   - **Plan** (`tools.enabled=false`, modo != FULL_REACTIVE): gera `ExecutionPlan` -> `PlanExecutorService`
   - **Reactive** (`mode=FULL_REACTIVE`): `ReactiveRunnerService` decide cada acao com heurísticas semanticas
7. executa a acao e espera quiescencia
8. reobserva a tela e valida o esperado
9. tenta recovery quando necessario
10. persiste logs, metricas, relatorios e evidencias

## Como O Agente Decide E Valida

O Agent QA nao usa classes CSS como contrato principal. Ele observa a tela por:

- accessibility tree nativa do Chromium via CDP, quando disponivel
- fallback por `ariaSnapshot`
- DOM purificado
- textos visiveis
- roles acessiveis, como `button`, `link`, `textbox`, `menuitem`
- sinais de console e network
- estado da pagina, como loading, modal, toast e erros de validacao

Cada observacao gera IDs efemeros como `el_001`, `el_002`. A LLM deve escolher apenas IDs da observacao atual. Depois de qualquer acao, o agente espera quiescencia, observa de novo e invalida os IDs antigos.

### Auth E Demand

Quando `auth.kind` e `formLogin` ou `storageState`, o login e precondicao do runtime. Isso significa:

- o agente faz login antes dos cenarios funcionais
- o `demand` deve descrever o que testar depois de autenticado
- nao coloque passos como "preencher email", "preencher senha" ou "clicar entrar" no demand

Bom:

```json
{
  "demand": {
    "title": "Smoke autenticado",
    "description": "Validar area autenticada\nAbrir menu de conta\nAlternar tema visual\nSair da aplicacao",
    "acceptanceCriteria": [
      "Uma area autenticada fica visivel",
      "O menu de conta fica visivel",
      "O tema visual muda sem erro critico",
      "Sair retorna para tela de login"
    ]
  }
}
```

Ruim:

```json
{
  "demand": {
    "description": "Preencher email\nPreencher senha\nClicar Entrar\nValidar dashboard"
  }
}
```

### Regras Contra Falso Positivo

O agente nao considera uma task funcional concluida apenas porque nao houve erro de console.

Exemplos de validacao fraca que sao rejeitados:

- clicar em `Conta e opcoes` e validar que `Conta e opcoes` continua visivel
- trocar tema e validar apenas `no_console_errors`
- deslogar e validar apenas `no_console_errors`
- navegar para a mesma URL e chamar isso de sucesso funcional

Para passar, a validacao precisa provar o resultado da task:

- menu abriu: algum item/painel do menu ficou visivel
- tema mudou: texto/opcao/estado visual esperado apareceu, ou a proxima observation mudou de forma valida
- logout funcionou: URL de login ou tela/form de login ficou visivel
- navegacao funcionou: URL ou texto especifico da tela alvo apareceu

### Menus E Fluxos Em Duas Etapas

Menus normalmente exigem duas decisoes:

1. clicar no trigger, por exemplo `Conta e opcoes`
2. observar o menu aberto e clicar no item, por exemplo `Sair`

O agente grava tentativas por task em memoria durante a run. Se uma tentativa falha por validacao fraca, a proxima decisao recebe esse historico e deve escolher outra estrategia.

### Logout E `Sair`

Logout tem uma regra especial porque e comum a LLM confundir o trigger do menu com o item final.

Se a task e de logout e a observacao mostra um elemento visivel com nome/texto:

- `Sair`
- `Logout`
- `Sign out`
- `Encerrar sessao`

o runtime clica semanticamente nesse item.

Mesmo assim, a task so passa se provar estado nao autenticado:

- URL contendo `/login`, `/signin`, `/sign-in` ou `/auth`
- texto/form visivel de login, como `Entrar`, `Login`, `E-mail`, `Senha`, `Acessar`

Se clicar em `Sair` e continuar autenticado, a task fica `BLOCKED` com evidencia.

### Checks Globais

Checks como estes sao tratados como restricoes/telemetria, nao como uma longa lista de tasks de clique:

- nao executar acoes destrutivas
- sem erro HTTP 5xx
- sem erro critico de console
- sem envio real
- sem falhas de rede

Eles continuam aparecendo nos sinais, reports e classificacao de bug, mas o planner evita transformar isso em passos que fiquem clicando aleatoriamente.

### Quando A Run Para

Em fluxo autenticado, o plano e linearizado para evitar cenarios independentes usando uma sessao que ja mudou de estado. Se uma task bloqueia ou gera bug `HIGH/CRITICAL`, a run para em vez de continuar clicando em outros cenarios com estado invalido.

## Exemplo HML/Producao Com Login

Use env vars para credenciais e deixe o JSON sem segredo:

```powershell
$env:MESHA_EMAIL="seu-email"
$env:MESHA_PASSWORD="sua-senha"
$env:GROQ_PROVIDER="sua-chave-groq"
npm run qa-agent -- run --config ./agent-qa.config.json --headed
```

Um config de producao/HML deve ser conservador:

- limite `allowedRoutes` ao dominio esperado
- descreva explicitamente o que e permitido
- descreva acoes proibidas no `demand.description`
- evite pedir criacao, envio, exclusao ou importacao em ambiente real
- para logout, escreva "Sair retorna para tela de login" ou equivalente

Exemplo de auth por IDs conhecidos:

```json
{
  "auth": {
    "kind": "formLogin",
    "loginUrl": "/",
    "usernameSelector": "#login-email",
    "passwordSelector": "#login-password",
    "submitSelector": "button[type='submit']",
    "usernameEnv": "MESHA_EMAIL",
    "passwordEnv": "MESHA_PASSWORD",
    "successWhen": {
      "urlContains": "meshamail.mesha.com.br"
    },
    "maxRetries": 1
  }
}
```

## Saidas Geradas

Cada run cria um diretorio em `output.runsDir` com arquivos como:

- `run.json`
- `config.json`
- `execution-plan.json`
- `execution-log.json`
- `run-data.json`
- `metrics.json`
- `execution-report.md`

Quando um bug e registrado, a pasta `bugs/<BUG-ID>/` recebe:

- `bug.json`
- `bug-report.md`
- `screenshot.png`
- `dom-snapshot.html`
- `network.json`
- `console.log`
- `trace.zip`
- `video.webm`

Se a run terminar com `PASSED` e as flags estiverem habilitadas no config, tambem sao salvos:

- `artifacts/traces/run-trace.zip`
- `artifacts/videos/run-video.webm`

## Codigos De Saida

- `0`: execucao sem bugs relevantes
- `1`: bugs encontrados ou run `FAILED/BLOCKED`
- `2`: erro de configuracao
- `3`: erro fatal de harness
- `4`: timeout total da run

## Exemplo Rapido Local

Suba a fixture HTML local:

```bash
node ./test/fixtures/server.mjs
```

Em outro terminal, rode:

```bash
npm run qa-agent -- validate-config --config ./configs/agent-qa.fixture.config.json
npm run qa-agent -- run --config ./configs/agent-qa.fixture.config.json
```

## Testes

Suite atual:

```bash
npm test
```

Comandos uteis:

```bash
npm run typecheck
npm run lint
```

## Documentacao Tecnica

As specs e ADRs do projeto estao em [doc/README.md](file:///c:/dev/apps/agent-qa/doc/README.md).

Arquitetura atual:

- [Runtime Core e Componentes](docs/architecture/22-runtime-component-map.md)
- [Tool Registry & Harness Tools](docs/architecture/tool-registry-v0.2.5.md)
