#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${PORT:-8080}"
SERVER_LOG="${PROJECT_ROOT}/.atlas-localhost.log"

if ! lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  cd "${PROJECT_ROOT}"
  nohup python3 -m http.server "${PORT}" >"${SERVER_LOG}" 2>&1 &
  sleep 1
fi

bash "${SCRIPT_DIR}/open-atlas.sh" local
