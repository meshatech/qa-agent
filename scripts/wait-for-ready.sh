#!/usr/bin/env bash
set -euo pipefail

URL="${1:-${QA_AGENT_BASE_URL:-}}"
if [[ -z "$URL" ]]; then
  echo "Usage: wait-for-ready.sh <url> or set QA_AGENT_BASE_URL" >&2
  exit 1
fi

TIMEOUT="${QA_AGENT_PREVIEW_TIMEOUT:-120}"
INTERVAL="${QA_AGENT_PREVIEW_INTERVAL:-2}"

deadline=$(( $(date +%s) + TIMEOUT ))

while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -L "$URL" || true)
  if [[ "$code" == "200" ]]; then
    exit 0
  fi
  if [[ $(date +%s) -ge $deadline ]]; then
    echo "Preview not ready after ${TIMEOUT}s (last HTTP ${code:-none})" >&2
    exit 1
  fi
  sleep "$INTERVAL"
done
