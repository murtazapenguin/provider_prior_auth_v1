#!/usr/bin/env bash
# scripts/policies/push-to-s3.sh
#
# Push local policy markdown up to the canonical S3 store. Use this AFTER
# editing locally so your edits propagate to the running app (the cron tick
# will sync them into Postgres within ~15 min).
#
# Usage:
#   ./scripts/policies/push-to-s3.sh             # dry-run + confirm prompt
#   ./scripts/policies/push-to-s3.sh --yes       # skip the confirm prompt

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/services/ai/.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
else
  echo "ERROR: ${ENV_FILE} not found" >&2
  exit 1
fi

BUCKET="${S3_POLICIES_BUCKET:-${S3_OCR_STAGING_BUCKET:-}}"
PREFIX="${S3_POLICIES_KEY_PREFIX:-policies/uhc/}"
LOCAL_DIR="${REPO_ROOT}/policies/uhc"

if [[ -z "${BUCKET}" ]]; then
  echo "ERROR: neither S3_POLICIES_BUCKET nor S3_OCR_STAGING_BUCKET is set" >&2
  exit 1
fi

if [[ ! -d "${LOCAL_DIR}" ]]; then
  echo "ERROR: ${LOCAL_DIR} does not exist — nothing to push" >&2
  exit 1
fi

DESTINATION="s3://${BUCKET}/${PREFIX}"
echo "Pushing: ${LOCAL_DIR} -> ${DESTINATION}"
echo "Dry run preview:"
aws s3 sync --dryrun \
  --content-type 'text/markdown; charset=utf-8' \
  --exclude '_*' \
  "${LOCAL_DIR}" "${DESTINATION}"

if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Proceed with the sync above? [y/N] " confirm
  if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

aws s3 sync \
  --content-type 'text/markdown; charset=utf-8' \
  --exclude '_*' \
  "${LOCAL_DIR}" "${DESTINATION}"
echo "Done."
