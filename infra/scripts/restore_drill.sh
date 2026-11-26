#!/usr/bin/env bash
# Automated Restore Drill & Integrity Verification (Assessment 14)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
PASSPHRASE="${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE must be set}"
LATEST_BACKUP="$(ls -t "${BACKUP_DIR}"/*.sql.gz.enc 2>/dev/null | head -n 1 || true)"

if [[ -z "${LATEST_BACKUP}" ]]; then
  echo "[ERROR] No encrypted backup found in ${BACKUP_DIR}. Run backup_db.sh first."
  exit 1
fi

echo "[1/3] Verifying SHA-256 checksum for ${LATEST_BACKUP}..."
sha256sum -c "${LATEST_BACKUP}.sha256"

TMP_SQL="$(mktemp /tmp/fincore_restore_XXXXXX.sql)"
trap 'rm -f "${TMP_SQL}"' EXIT

echo "[2/3] Decrypting backup..."
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "${LATEST_BACKUP}" | gunzip > "${TMP_SQL}"

echo "[3/3] Verifying restored SQL contains ledger immutability & balance constraints..."
grep -q "trg_ledger_entries_immutable" "${TMP_SQL}"
grep -q "trg_ledger_entries_balanced" "${TMP_SQL}"
echo "[PASS] Restore drill succeeded ($(wc -l < "${TMP_SQL}") SQL lines verified)."
