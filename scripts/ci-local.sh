#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml — run before pushing Task 2 changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PLAYWRIGHT_IMAGE="${CI_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-noble}"
RELEASE_TAG="${CI_RELEASE_TAG:-qa-agent:ci}"

step() {
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════════"
}

step "job: check (container ${PLAYWRIGHT_IMAGE})"
# Isolated node_modules volume — avoids root-owned files on the host workspace
# (GitHub Actions gets a fresh checkout per job; locally we must not pollute node_modules).
docker run --rm \
  -v "${ROOT}:/work" \
  -v qa-agent-ci-node-modules:/work/node_modules \
  -w /work \
  "${PLAYWRIGHT_IMAGE}" \
  bash -lc 'npm ci --no-audit --no-fund && npm run check'

step "job: docker-smoke (npm ci + build)"
# CI gets a fresh checkout; locally we build in an isolated node_modules volume so a
# prior root-owned node_modules on the host cannot break the simulation.
docker run --rm \
  -v "${ROOT}:/work" \
  -v qa-agent-smoke-node-modules:/work/node_modules \
  -w /work \
  node:22-bookworm-slim \
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
