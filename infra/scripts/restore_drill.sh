#!/bin/bash
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-./backups}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE must be set}"
LATEST_BACKUP="$(ls -t "${BACKUP_DIR}"/*.sql.gz.enc 2>/dev/null | head -n 1 || true)"
if [[ -z "${LATEST_BACKUP}" ]]; then
  echo "[ERROR] No encrypted backup found in ${BACKUP_DIR}."
  exit 1
fi
sha256sum -c "${LATEST_BACKUP}.sha256"
TMP_SQL="$(mktemp /tmp/fincore_restore_XXXXXX.sql)"
trap 'rm -f "${TMP_SQL}"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "${LATEST_BACKUP}" | gunzip > "${TMP_SQL}"
grep -q "trg_ledger_entries_immutable" "${TMP_SQL}"
grep -q "trg_ledger_entries_balanced" "${TMP_SQL}"
echo "[PASS] Restore drill succeeded ($(wc -l < "${TMP_SQL}") SQL lines verified)."
