#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODE="${1:-file}"
ATLAS_APP="ChatGPT Atlas"
INDEX_PATH="${PROJECT_ROOT}/index.html"
LOCAL_URL="http://localhost:8080/index.html"

if [[ "${MODE}" == "local" ]]; then
  open -a "${ATLAS_APP}" "${LOCAL_URL}"
else
  open -a "${ATLAS_APP}" "${INDEX_PATH}"
fi
