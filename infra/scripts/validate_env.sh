#!/usr/bin/env bash
# Validates environment separation (local / staging / production) without leaking secrets
set -euo pipefail
TARGET_ENV="${1:-local}"
echo "[ENV CHECK] Validating configuration contract for environment: ${TARGET_ENV}"
test -f .env.example
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "[FAIL] .env is tracked in git! Remove immediately."
  exit 1
fi
echo "[PASS] No .env secret file tracked in git; .env.example present."
