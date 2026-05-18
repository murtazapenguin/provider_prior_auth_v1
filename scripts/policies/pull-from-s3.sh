#!/usr/bin/env bash
# scripts/policies/pull-from-s3.sh
#
# Pull policy markdown from the canonical S3 store down to the local mirror.
# Use this before editing locally so your edits start from the latest prod
# state (someone may have made an in-prod edit since you last pulled).
#
# Usage:
#   ./scripts/policies/pull-from-s3.sh           # dry-run + confirm prompt
#   ./scripts/policies/pull-from-s3.sh --yes     # skip the confirm prompt

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/services/ai/.env"

# Source env vars from services/ai/.env (AWS creds + bucket).
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

mkdir -p "${LOCAL_DIR}"

SOURCE="s3://${BUCKET}/${PREFIX}"
echo "Pulling: ${SOURCE} -> ${LOCAL_DIR}"
echo "Dry run preview:"
aws s3 sync --dryrun "${SOURCE}" "${LOCAL_DIR}"

if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Proceed with the sync above? [y/N] " confirm
  if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

aws s3 sync "${SOURCE}" "${LOCAL_DIR}"
echo "Done."
