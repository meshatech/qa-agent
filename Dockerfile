# ───────────────────────────────────────────────────────────────
# Multi-stage build para agent-qa (CLI com Playwright)
#
#   Stage 1 (builder)  → node:22 + deps + build TypeScript
#   Stage 2 (runtime)  → imagem Playwright oficial + dist + node_modules pruned
# ───────────────────────── Builder ─────────────────────────
FROM node:22 AS builder

WORKDIR /app

# Cache de deps: copiar package.json+lock primeiro
COPY package*.json ./
COPY scripts/ ./scripts/
RUN npm ci --no-audit --no-fund

# Resto do codigo + build
COPY tsconfig*.json ./
COPY src/ ./src/
COPY test/ ./test/
RUN npm run build

# Remove devDependencies pro stage final ficar magro
RUN npm prune --omit=dev --no-audit --no-fund

# ───────────────────────── Runtime ─────────────────────────
FROM mcr.microsoft.com/playwright:v1.61.0-noble

# tini = init minimo pra propagar SIGTERM
RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# Sinaliza ao harness Playwright que estamos em container → Chromium roda com
# --no-sandbox (obrigatorio como root). Detecção por cgroup falha no cgroup v2.
ENV QA_AGENT_CONTAINER=1
# Browsers já vêm pré-instalados na imagem base do Playwright.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copia so o necessario pra rodar
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY scripts/ ./scripts/

# Symlink global pro CLI
RUN chmod +x ./dist/main.js \
  && ln -sf /app/dist/main.js /usr/local/bin/qa-agent

# Diretorio padrao de runs (montado via volume)
RUN mkdir -p /app/qa-agent-runs

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/qa-agent"]
CMD ["--help"]
