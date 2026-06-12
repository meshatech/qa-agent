# Autenticação em CI

O comando `capture-auth` é **interativo** (abre navegador e espera input do usuário), portanto **inviável em pipeline**. Este documento descreve os 3 caminhos suportados para autenticar o agente em CI, ordenados por preferência.

---

## Caminho 1: `formLogin` (canônico)

**Quando usar:** a aplicação tem login por formulário (usuário/senha).

**Ideia:** o preview é semeado com um usuário de teste no build; o agente preenche o formulário automaticamente a cada run.

### 1.1 Criar usuário de teste no preview

No script/fluxo de build do preview, crie um usuário dedicado ao QA:

```bash
# Exemplo: seed em aplicação web com banco relacional
psql "$DATABASE_URL" <<-'SQL'
  INSERT INTO users (email, password_hash, role)
  VALUES ('qa.agent@exemplo.com', 'hash_da_senha', 'user')
  ON CONFLICT (email) DO NOTHING;
SQL
```

Ou, se usar uma API de setup:

```bash
curl -X POST "${PREVIEW_URL}/api/test-setup/seed-user" \
  -H "Authorization: Bearer ${TEST_SETUP_TOKEN}" \
  -d '{"email":"qa.agent@exemplo.com","password":"SenhaForte123"}'
```

> **Importante:** o usuário deve existir **antes** do `wait-for-ready` terminar.

### 1.2 Configurar `agent-qa.config.json`

```json
{
  "auth": {
    "kind": "formLogin",
    "loginUrl": "/login",
    "usernameSelector": "input[name='email']",
    "passwordSelector": "input[name='password']",
    "submitSelector": "button[type='submit']",
    "usernameEnv": "QA_AGENT_USER",
    "passwordEnv": "QA_AGENT_PASS",
    "successWhen": {
      "urlContains": "/dashboard"
    },
    "maxRetries": 1
  }
}
```

| Campo | Descrição |
|---|---|
| `loginUrl` | Caminho relativo ao `baseUrl` (ex: `/login`) |
| `usernameSelector` / `passwordSelector` / `submitSelector` | Seletor CSS, ou objeto `{ "strategy": "role", "role": "button", "name": "Entrar" }` |
| `usernameEnv` / `passwordEnv` | Nome das variáveis de ambiente que carregam as credenciais |
| `successWhen` | Condição que indica login bem-sucedido (`urlContains` e/ou `textVisible`) |

### 1.3 Configurar secrets

No repositório alvo, adicione:

- `QA_AGENT_USER` = `qa.agent@exemplo.com`
- `QA_AGENT_PASS` = `SenhaForte123`

No workflow, as envs já estão mapeadas:

```yaml
env:
  QA_AGENT_USER: ${{ secrets.QA_AGENT_USER }}
  QA_AGENT_PASS: ${{ secrets.QA_AGENT_PASS }}
```

---

## Caminho 2: `storageState` seed

**Quando usar:** SSO/OAuth, MFA, ou qualquer fluxo que `formLogin` não consiga alcançar.

**Ideia:** você gera o estado de armazenamento (cookies + localStorage) **uma vez localmente**, salva como secret/artifact criptografado, e o agente restaura em CI.

> ⚠️ Storage state tem **validade limitada** (sessões expiram, tokens rotacionam). Prefira `formLogin` sempre que possível.

### 2.1 Gerar storage state localmente

Com o agente instalado localmente e a config apontando para o ambiente de preview (ou staging):

```bash
qa-agent capture-auth \
  --config ./agent-qa.config.json \
  --output ./.agent-qa/state/auth.json
```

Este comando abre um navegador não-headless. Faça login manualmente (SSO, MFA, etc.) e pressione **Enter** no terminal para salvar o estado.

### 2.2 Criptografar o arquivo

O arquivo contém cookies de sessão — **nunca commite desprotegido**:

```bash
# Criptografar com gpg (ou age/sops)
gpg --symmetric --cipher-algo AES256 --output auth.json.gpg \
  ./.agent-qa/state/auth.json

# Ou com openssl
openssl enc -aes-256-cbc -salt -pbkdf2 \
  -in ./.agent-qa/state/auth.json \
  -out auth.json.enc
```

Adicione a senha de criptografia como secret: `QA_AGENT_STORAGE_PASS`.

### 2.3 Adicionar ao CI

Opção A: **GitHub Secret** (recomendado para repos privados)

```bash
# O arquivo criptografado vira secret (base64)
base64 -w0 auth.json.gpg | gh secret set QA_AGENT_STORAGE_GPG
```

No workflow:

```yaml
- name: Restore auth session
  run: |
    mkdir -p .agent-qa/pipeline/state
    echo "$QA_AGENT_STORAGE_GPG" | base64 -d > auth.json.gpg
    gpg --batch --yes --passphrase "$QA_AGENT_STORAGE_PASS" -d auth.json.gpg \
      > .agent-qa/pipeline/state/auth.json
  env:
    QA_AGENT_STORAGE_GPG: ${{ secrets.QA_AGENT_STORAGE_GPG }}
    QA_AGENT_STORAGE_PASS: ${{ secrets.QA_AGENT_STORAGE_PASS }}
```

Opção B: **Artifact pré-gerado** (menos seguro, mas mais simples)

Gere o storage state em um workflow separado, salve como artifact e restaure no job do agente:

```yaml
- name: Download auth artifact
  uses: actions/download-artifact@v4
  with:
    name: qa-agent-auth-state
    path: .agent-qa/pipeline/state/
```

### 2.4 Configurar `agent-qa.config.json`

```json
{
  "auth": {
    "kind": "storageState",
    "path": ".agent-qa/pipeline/state/auth.json"
  }
}
```

---

## Caminho 3: `none`

**Quando usar:** a aplicação tem páginas públicas e não requer autenticação para os fluxos testados.

### 3.1 Configuração

```json
{
  "auth": {
    "kind": "none"
  }
}
```

Nenhum secret extra necessário.

---

## Resumo comparativo

| Caminho | Setup | Manutenção | Segurança | Recomendação |
|---|---|---|---|---|
| `formLogin` | Médio (usuário de teste + secrets) | Baixa (usuário fixo) | Alta (secrets nativos do GitHub) | **Preferido** |
| `storageState` | Alto (geração manual + criptografia) | Alta (expira) | Média (requer criptografia extra) | Quando formLogin não alcança |
| `none` | Zero | Zero | — | Páginas públicas apenas |

---

## Referência rápida de `auth` no schema

```typescript
auth:
  | { kind: "none" }
  | { kind: "storageState"; path: string }
  | {
      kind: "formLogin";
      loginUrl: string;
      usernameSelector: string | LocatorDescriptor;
      passwordSelector: string | LocatorDescriptor;
      submitSelector: string | LocatorDescriptor;
      usernameEnv: string;      // nome da env, ex: "QA_AGENT_USER"
      passwordEnv: string;      // nome da env, ex: "QA_AGENT_PASS"
      successWhen?: { urlContains?: string; textVisible?: string };
      maxRetries?: number;      // default: 1
    }
```

Veja [`src/domain/schemas/config.schema.ts`](../src/domain/schemas/config.schema.ts) para a definição completa.
