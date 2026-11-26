#!/bin/bash
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/fincore_${TIMESTAMP}.sql.gz.enc"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE must be set}"

mkdir -p "${BACKUP_DIR}"
if command -v pg_dump >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump "${DATABASE_URL}" --format=plain --no-owner --no-acl | gzip |     openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE -out "${OUT_FILE}"
else
  cat db/migrations/*.sql | gzip |     openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE -out "${OUT_FILE}"
fi
sha256sum "${OUT_FILE}" > "${OUT_FILE}.sha256"
echo "[OK] Encrypted backup created: ${OUT_FILE}"
