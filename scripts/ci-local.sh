#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml — run before pushing Task 2 changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PLAYWRIGHT_IMAGE="${CI_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-noble}"
NODE_IMAGE="${CI_NODE_IMAGE:-node:22-bookworm-slim}"
RELEASE_TAG="${CI_RELEASE_TAG:-qa-agent:ci}"

step() {
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════════"
}

run_in_node_volume() {
  local label="$1"
  shift
  step "job: ${label}"
  docker run --rm \
    -v "${ROOT}:/work" \
    -v "qa-agent-ci-${label}-node-modules:/work/node_modules" \
    -w /work \
    "${NODE_IMAGE}" \
    bash -lc "npm ci --no-audit --no-fund && $*"
}

run_in_node_volume typecheck npm run typecheck
run_in_node_volume lint npm run lint

step "job: test (container ${PLAYWRIGHT_IMAGE})"
docker run --rm \
  -v "${ROOT}:/work" \
  -v qa-agent-ci-test-node-modules:/work/node_modules \
  -w /work \
  "${PLAYWRIGHT_IMAGE}" \
  bash -lc 'npm ci --no-audit --no-fund && npm test'

run_in_node_volume validate-agent-config npm run validate:agent-config

step "job: docker-smoke (npm ci + build)"
docker run --rm \
  -v "${ROOT}:/work" \
  -v qa-agent-smoke-node-modules:/work/node_modules \
  -w /work \
  "${NODE_IMAGE}" \
  bash -lc 'npm ci --no-audit --no-fund && npm run build'

step "job: docker-smoke (image + CLI checks)"
docker build -t "${RELEASE_TAG}" .

echo ""
echo "→ smoke: qa-agent --version"
docker run --rm "${RELEASE_TAG}" qa-agent --version

echo ""
echo "→ smoke: qa-agent pipeline --help"
docker run --rm "${RELEASE_TAG}" qa-agent pipeline --help >/dev/null

echo ""
echo "→ smoke: validate-config (fixture, fake LLM)"
docker run --rm \
  -e GROQ_PROVIDER=fake \
  -v "${ROOT}/configs:/configs:ro" \
  "${RELEASE_TAG}" \
  qa-agent validate-config --config /configs/agent-qa.fixture.config.json

step "ci-local OK — same steps as .github/workflows/ci.yml"
