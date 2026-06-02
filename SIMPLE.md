# agent-qa — Uso Simples (Teste Fechado)

> Guia para usar o agente sem pipeline, ClickUp, PR context, ou complexidade de CI.
> Apenas: config → run → resultado.

---

## O que você NÃO precisa

| Componente | Quando precisa | Para uso pessoal |
|---|---|---|
| `preflight` | Valida git/ClickUp antes de CI | ❌ Ignore |
| `read-pr-context` | Lê diff do PR em GitHub Actions | ❌ Ignore |
| ClickUp (`clickup.*` na config) | Integra com task manager | ❌ Remova |
| `pr.*` na config | Contexto de pull request | ❌ Remova |
| `allowedRoutes` | Restringe navegação em CI | ❌ Opcional |
| `scenarioSelection` | Seleciona cenários em massa | ❌ Opcional |
| `agentVersion` | Versionamento de agente | ❌ Opcional |

---

## Configuração mínima funcional

Crie `agent-qa.minimal.config.json`:

```json
{
  "baseUrl": "https://seu-app.local",
  "appDomains": ["seu-app.local"],
  "demand": {
    "id": "smoke-001",
    "title": "Smoke test",
    "description": "Login, navegação e logout"
  },
  "browser": {
    "headed": true
  },
  "auth": {
    "kind": "storageState",
    "path": "./auth.json"
  },
  "llm": {
    "provider": "groq",
    "model": "llama-3.1-8b-instant",
    "apiKeyEnv": "GROQ_API_KEY"
  }
}
```

**Só isso.** O resto usa defaults.

### Sem autenticação (ainda mais simples)

```json
{
  "baseUrl": "https://seu-app.local",
  "appDomains": ["seu-app.local"],
  "demand": {
    "id": "smoke-001",
    "title": "Smoke test",
    "description": "Navegação básica"
  },
  "auth": { "kind": "none" },
  "llm": {
    "provider": "groq",
    "model": "llama-3.1-8b-instant",
    "apiKeyEnv": "GROQ_API_KEY"
  }
}
```

---

## Comandos que você precisa

### 1. Capturar login (uma vez)

```bash
npx tsx src/main.ts capture-auth \
  --config ./agent-qa.minimal.config.json \
  --output ./auth.json
```

Preencha usuário/senha no browser. O arquivo `auth.json` guarda a sessão.

### 2. Rodar o teste

```bash
npx tsx src/main.ts run \
  --config ./agent-qa.minimal.config.json
```

Resultado: JSON no console + pasta em `./qa-agent-runs/YYYY-MM-DD_HH-mm-ss/`

### 3. Inspecionar resultado

```bash
npx tsx src/main.ts inspect --run-id <id>
```

### 4. Validar config

```bash
npx tsx src/main.ts validate-config \
  --config ./agent-qa.minimal.config.json
```

---

## O que o "run" faz por baixo (resumido)

```
1. Carrega config (Zod valida)
2. Gera cenários a partir do demand.description (LLM)
3. Gera plano de execução (LLM ou factory)
4. Abre browser → executa steps → valida postconditions
5. Se falha: retry, fallback, replan (automático)
6. Salva resultado em ./qa-agent-runs/
```

Você não precisa entender os steps intermediários. A demanda descreve o que testar e o agente faz o resto.

---

## Pipeline que você pode ignorar

```bash
# NÃO precisa disso para uso pessoal
npx tsx src/main.ts preflight ...
npx tsx src/main.ts read-pr-context ...
```

---

## Modos de execução simplificados

### Modo mais barato (menos chamadas LLM)

```json
{
  "runtime": {
    "mode": "HYBRID_GUARDED",
    "planning": {
      "executionPlanStrategy": "factory_first"
    }
  }
}
```

O `factory_first` gera o plano sem LLM quando possível. **Custa ~3 chamadas LLM** por run vs ~14-40 no modo reativo.

### Modo mais simples (sem plano, reativo)

```json
{
  "runtime": {
    "mode": "FULL_REACTIVE",
    "maxActionsPerTask": 5
  }
}
```

O LLM decide cada ação vendo a tela. Mais caro em chamadas LLM, mas zero complexidade de plano.

---

## Estrutura de pastas que você vê

```
qa-agent-runs/
├── 2026-06-01_17-00-00/          # run de hoje
│   ├── run-report.json             # resultado
│   ├── observations/               # screenshots
│   ├── traces/                     # playwright trace (se falhou)
│   └── video/                      # gravação (se falhou)
```

---

## Exemplo completo: login → formulário → logout

`agent-qa.minimal.config.json`:

```json
{
  "baseUrl": "https://app.local",
  "appDomains": ["app.local"],
  "demand": {
    "id": "smoke-001",
    "title": "Login e navegação",
    "description": "Fazer login, acessar página de perfil, preencher nome e salvar. Sair da conta."
  },
  "auth": { "kind": "storageState", "path": "./auth.json" },
  "llm": { "provider": "groq", "model": "llama-3.1-8b-instant", "apiKeyEnv": "GROQ_API_KEY" },
  "runtime": {
    "mode": "HYBRID_GUARDED",
    "planning": { "executionPlanStrategy": "llm_with_factory_fallback" }
  }
}
```

Rode:

```bash
# 1. Só na primeira vez (ou quando a sessão expirar)
npx tsx src/main.ts capture-auth --config ./agent-qa.minimal.config.json --output ./auth.json

# 2. Sempre que quiser testar
npx tsx src/main.ts run --config ./agent-qa.minimal.config.json
```

O agente vai:
1. Abrir o browser já logado (via `auth.json`)
2. Navegar para perfil
3. Preencher nome
4. Clicar salvar
5. Clicar sair
6. Validar que voltou para login

---

## Resumo mental

| Conceito | O que é na prática |
|---|---|
| **Demand** | O que você quer testar, em português ou inglês |
| **Config** | URL do app, qual browser, qual LLM, como logar |
| **Run** | Executa a demanda e gera relatório |
| **Auth** | `storageState` = arquivo de sessão já logada |
| **Resultado** | JSON com pass/fail + screenshots se falhou |

**Não precisa entender:** ExecutionPlan, PlanCondition, Replan, ScenarioCatalog, Pipeline, ClickUp, PR context.

**Só precisa:** uma demanda escrita, uma config JSON, e rodar `run`.
