# Onboarding do QA Agent em um Repositório Alvo

> Tempo estimado: **≤ 30 minutos**

---

## Checklist de 4 passos

### 1. Copiar o workflow

Copie [`qa-agent.yml`](./qa-agent.yml) para `.github/workflows/qa-agent.yml` no repositório alvo.

**Atenção:** você **deve adaptar** o job `build-preview` (linhas 30–40) para o seu stack de deploy. O único requisito é que o job exponha `preview_url` como output.

---

### 2. Criar `agent-qa.config.json`

Crie na raiz do repo alvo:

```json
{
  "baseUrl": "${QA_AGENT_BASE_URL}",
  "appDomains": ["pr-*.preview.exemplo.com"],
  "demand": { "source": "clickup" },
  "auth": { "kind": "none" },
  "llm": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "apiKeyEnv": "GROQ_API_KEY"
  },
  "runtime": {
    "mode": "HYBRID_GUARDED"
  },
  "evidence": {
    "video": "on-failure",
    "trace": "on-failure"
  }
}
```

Ajuste conforme sua realidade:

| Campo | O que mudar |
|---|---|
| `appDomains` | Domínio(s) do seu preview (wildcards aceitos) |
| `auth` | Veja [docs/auth-in-ci.md](../auth-in-ci.md) — escolha entre `formLogin`, `storageState` ou `none` |
| `llm.provider` | `groq` ou `openai` |
| `llm.apiKeyEnv` | Nome da env que carrega a chave (`GROQ_API_KEY` ou `OPENAI_API_KEY`) |

> **Dica:** `baseUrl` usa `${QA_AGENT_BASE_URL}` apenas para tornar a intenção explícita. O agente aceita override direto pela variável de ambiente `QA_AGENT_BASE_URL`.

---

### 3. Configurar secrets no repositório

Vá em **Settings → Secrets and variables → Actions** e adicione:

| Secret | Obrigatório | Descrição |
|---|---|---|
| `CLICKUP_TOKEN` | ✅ | Token da API do ClickUp (usado em `prepare` e `correlate`) |
| `GROQ_API_KEY` ou `OPENAI_API_KEY` | ✅ | Chave da LLM (usada em `generate-plan`, `execute`, `learning`) |
| `QA_AGENT_USER` / `QA_AGENT_PASS` | Se `auth.kind === "formLogin"` | Credenciais de teste (veja [auth-in-ci.md](../auth-in-ci.md#caminho-1-formlogin-canônico)) |

> `GITHUB_TOKEN` é injetado automaticamente pelo GitHub Actions.

---

### 4. (Opcional) Bootstrap de memória

Se quiser que o agente use contexto do projeto durante o planejamento:

```bash
# localmente, com o repo clonado
npx qa-agent@latest pipeline generate-memory
# ou, se já tiver o agente instalado globalmente:
qa-agent pipeline generate-memory
```

Commit o arquivo gerado:

```bash
git add .agent-qa/memory.md
git commit -m "chore(qa): bootstrap agent memory"
```

---

## Vínculo automático PR ↔ ClickUp

O agente já resolve a task ID a partir do PR usando esta ordem:

1. `pullRequest.clickUpTaskId` no config
2. Config `clickup.taskId`
3. Nome da branch (`MESHAP-1234-feature`)
4. Título ou descrição do PR (`MESHAP-1234: descrição`)

Portanto, **nenhuma config extra é necessária** se você seguir a convenção de nomenclatura.

---

## Depuração

| Sintoma | Causa provável | Solução |
|---|---|---|
| "Preview not ready after 120s" | O job de preview demora mais que 120s | Aumente `QA_AGENT_PREVIEW_TIMEOUT` |
| "Missing env QA_AGENT_USER" | `formLogin` ativo mas secrets faltando | Adicione os secrets ou mude `auth.kind` para `"none"` |
| Comentário não aparece no PR | `GITHUB_TOKEN` sem permissão `pull-requests: write` | Verifique `permissions` no workflow |
| Artifacts vazios | Upload rodou antes do agente criar arquivos | O `upload-artifact` usa `if: always()`, então verifique se `.agent-qa/pipeline/` foi criado |

---

## Estrutura de arquivos no repo alvo (resumo)

```
repo-alvo/
├── .github/
│   └── workflows/
│       └── qa-agent.yml          ← copiado do template
├── agent-qa.config.json          ← criado no passo 2
└── .agent-qa/
    └── memory.md                 ← opcional (passo 4)
```

São **3 arquivos no máximo** para integrar o agente em um novo repositório.
