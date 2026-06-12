# Smoke Real — Integração em Repo Alvo

> Este é um **template/exemplo**. Copie para o repo alvo e adapte todos os valores `<PLACEHOLDER>`.

## Pré-requisitos no repo alvo

- [ ] Runner self-hosted `[self-hosted, vps]` configurado no GitHub Actions
- [ ] Preview que publica uma URL por PR (ex: `https://pr-<N>.preview.<app>.com.br`)
- [ ] Job de preview existente que expõe `preview_url` como output
- [ ] Secrets no repositório:
  - `CLICKUP_TOKEN`
  - `GROQ_API_KEY` (ou `OPENAI_API_KEY`)
  - Secrets de auth conforme o caminho escolhido em `docs/auth-in-ci.md`
- [ ] Task ClickUp vinculada ao PR (nome da branch ou título do PR com task ID)

---

## Passo a passo

### 1. Criar branch

```bash
git checkout -b smoke/qa-agent-test
```

### 2. Copiar arquivos

Copie para o repo alvo:

```
<repo-alvo>/
├── .github/workflows/qa-agent.yml   ← copiar de configs/target-repo-smoke/qa-agent.yml
├── agent-qa.config.json             ← copiar de configs/target-repo-smoke/agent-qa.config.json
```

### 3. Adaptar o workflow

No `qa-agent.yml`, **substitua o job `build-preview`** pelo job real do repo alvo. O único requisito é que o job exponha `preview_url` como output.

Exemplo (substitua pelo deploy real):

```yaml
jobs:
  build-preview:
    runs-on: [self-hosted, vps]
    outputs:
      preview_url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@v4
      - name: Deploy preview
        id: deploy
        run: |
          # Substitua pelo deploy real (docker compose, deploy script, etc.)
          echo "url=https://pr-${{ github.event.number }}.preview.<APP>.com.br" >> "$GITHUB_OUTPUT"
```

### 4. Adaptar o config

O `agent-qa.config.json` é um **exemplo** com valores de um app específico. **Adapte tudo:**
- `appDomains` — domínios do app
- `auth` — caminho de autenticação conforme `docs/auth-in-ci.md`
- `demand.id` — task ClickUp do PR de teste
- `llm.apiKeyEnv` — `GROQ_API_KEY` ou `OPENAI_API_KEY`
- `runtime.semanticAliases` — termos específicos do app
- `allowedRoutes` — URLs permitidas
- `classifier.knownTrackingDomains` — domínios de tracking do app

### 5. Commit e push

```bash
git add .github/workflows/qa-agent.yml agent-qa.config.json
git commit -m "chore(qa): add qa-agent workflow for smoke test"
git push -u origin smoke/qa-agent-test
```

### 6. Abrir PR

Abra um PR no GitHub com:
- Branch: `smoke/qa-agent-test`
- Título ou descrição contendo a task ClickUp (ex: `PROJ-1234: smoke qa-agent`)
- Isso garante que o preflight resolva a task ID

### 7. Verificar execução

No GitHub Actions, verifique:
1. Job `build-preview` sobe o preview e responde 200
2. Job `qa-agent` roda o container `ghcr.io/mesha/qa-agent:v2`
3. `wait-for-ready` passa (preview responde)
4. `pipeline all` executa todas as etapas
5. Comentário do agente aparece no PR (upsert)
6. Artifacts são salvos em `qa-agent-evidence-pr-<N>`

### 8. Validar resultados

- [ ] Comentário do PR tem status, cobertura de critérios, cenários
- [ ] Artifacts baixáveis (vídeo, screenshots, `run.json`)
- [ ] Sem erros no log do job
- [ ] Se falhar, o log mostra qual etapa falhou (fail-fast)

---

## Troubleshooting

| Sintoma | Causa | Solução |
|---|---|---|
| "Preview not ready after 120s" | Preview demora mais que 120s | Aumente `QA_AGENT_PREVIEW_TIMEOUT` no workflow |
| "Missing env XXX" | Secrets de auth não configurados | Adicione os secrets conforme o caminho de auth escolhido em `docs/auth-in-ci.md` |
| "ClickUp task ID not found" | PR não vinculado a task | Inclua task ID no nome da branch ou título do PR |
| "Config file not found" | `agent-qa.config.json` não está na raiz | Verifique se o arquivo foi commitado |
| Comentário não aparece | `GITHUB_TOKEN` sem permissão | Verifique `permissions: pull-requests: write` no workflow |

---

## Resultado esperado

Se o smoke passar, a Task 4 poderá ser marcada como **✅ IMPLEMENTADA**.
