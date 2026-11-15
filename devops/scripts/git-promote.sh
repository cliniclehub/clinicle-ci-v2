#!/usr/bin/env bash
# Promote git branches via GitHub (gh CLI — HTTPS API, no git SSH).
#
# Usage: git-promote.sh <dev|tst|prod>
# Requires: gh CLI authenticated (gh auth login) with repo write access.
set -euo pipefail

PROMOTE_TARGET="${1:-}"
if [[ -z "${PROMOTE_TARGET}" ]]; then
  echo "Usage: $0 <dev|tst|prod>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVOPS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DEVOPS_ROOT}/.." && pwd)"
DEPLOY_ENV="${DEVOPS_ROOT}/deploy/deploy.env"

if [[ -f "${DEPLOY_ENV}" ]]; then
  # shellcheck source=/dev/null
  source "${DEPLOY_ENV}"
fi

GIT_SOURCE_BRANCH="${GIT_SOURCE_BRANCH:-ammar_branch}"

case "${PROMOTE_TARGET}" in
  dev)
    TARGET_BRANCH=dev
    SOURCE_BRANCH="${GIT_SOURCE_BRANCH}"
    ALLOW_MERGE_COMMIT=1
    ;;
  tst)
    TARGET_BRANCH=tst
    SOURCE_BRANCH=dev
    ALLOW_MERGE_COMMIT=
    ;;
  prod)
    TARGET_BRANCH=main
    SOURCE_BRANCH=tst
    ALLOW_MERGE_COMMIT=
    ;;
  *)
    echo "[git-promote] Invalid target: ${PROMOTE_TARGET}"
    exit 1
    ;;
esac

case "${PROMOTE_TARGET}" in
  dev)  DEPLOY_MAKE_TARGET=deploy-dev ;;
  tst)  DEPLOY_MAKE_TARGET=deploy-test ;;
  prod) DEPLOY_MAKE_TARGET=deploy-prd ;;
esac

if ! command -v gh >/dev/null 2>&1; then
  echo "[git-promote] ERROR: gh CLI not found. Install: https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "[git-promote] ERROR: gh is not authenticated. Run: gh auth login"
  exit 1
fi

# Prefer origin over gh's default remote resolution. When an `upstream` remote
# still points at a renamed/template parent (e.g. clinicle-ci),
# bare `gh repo view` resolves that stale repo and 404s on branch/PR APIs.
resolve_repo_slug() {
  local origin_url
  if [[ -n "${GH_REPO:-}" ]]; then
    echo "${GH_REPO}"
    return 0
  fi
  origin_url="$(git -C "${REPO_ROOT}" remote get-url origin 2>/dev/null || true)"
  if [[ -n "${origin_url}" ]]; then
    gh repo view "${origin_url}" --json nameWithOwner -q .nameWithOwner
    return 0
  fi
  gh repo view --json nameWithOwner -q .nameWithOwner
}

REPO_SLUG="$(resolve_repo_slug)"
VERSION_FILE="${REPO_ROOT}/VERSION"
VERSION="$(tr -d ' \n\r' < "${VERSION_FILE}" 2>/dev/null || echo unknown)"

branch_sha() {
  gh api "repos/${REPO_SLUG}/git/ref/heads/${1}" -q .object.sha
}

update_branch_ref() {
  local sha="$1"
  local branch="$2"
  local force="${3:-0}"
  local -a args=(-f "sha=${sha}")

  if [[ "${force}" -eq 1 ]]; then
    args+=(-F "force=true")
  fi

  gh api -X PATCH "repos/${REPO_SLUG}/git/refs/heads/${branch}" "${args[@]}" >/dev/null
}

echo "[git-promote] ${SOURCE_BRANCH} -> ${TARGET_BRANCH} (${REPO_SLUG})"

SOURCE_SHA="$(branch_sha "${SOURCE_BRANCH}")"
TARGET_SHA="$(branch_sha "${TARGET_BRANCH}")"
SHORT_SHA="$(printf '%.7s' "${SOURCE_SHA}")"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ "${SOURCE_SHA}" == "${TARGET_SHA}" ]]; then
  echo "[git-promote] Already up to date (${SHORT_SHA}). Nothing to do."
  exit 0
fi

# Tip SHAs can differ after a merge commit even when SOURCE is fully contained in TARGET.
read -r COMPARE_STATUS AHEAD_BY BEHIND_BY < <(
  gh api "repos/${REPO_SLUG}/compare/${TARGET_BRANCH}...${SOURCE_SHA}" \
    --jq '"\(.status) \(.ahead_by) \(.behind_by)"'
)

if [[ "${AHEAD_BY}" == "0" ]]; then
  TARGET_SHORT="$(printf '%.7s' "${TARGET_SHA}")"
  echo "[git-promote] ${SOURCE_BRANCH} is already on ${TARGET_BRANCH} (${TARGET_SHORT})."
  echo "[git-promote] No new commits to promote (ahead_by=0, behind_by=${BEHIND_BY}). Skipping."
  exit 0
fi

FF_POSSIBLE=0
if [[ "${COMPARE_STATUS}" == "behind" || "${COMPARE_STATUS}" == "identical" ]]; then
  FF_POSSIBLE=1
fi

# Soft maturity gate: only when promoting feature work into dev.
# Intentional pause so builders can decide docs are ready (or N/A) before code moves.
prompt_docs_reminder_for_dev() {
  if [[ "${PROMOTE_TARGET}" != "dev" ]]; then
    return 0
  fi
  if [[ "${SKIP_DOCS_REMINDER:-}" == "1" ]]; then
    echo "[git-promote] Docs reminder skipped (SKIP_DOCS_REMINDER=1)."
    return 0
  fi

  echo ""
  echo "[git-promote] Docs check (soft reminder — pause before promoting to ${TARGET_BRANCH})"
  echo "  Before this code lands on ${TARGET_BRANCH}, quickly assess whether docs need a pass:"
    echo "    - DDL / migration if schema changed          → devops/db-migrations/NNN_name.sql"
    echo "    - BRD if product rules or behavior changed   → devops/docs/system_docs/1. requirements/"
    echo "    - SDD if design/contracts changed            → devops/docs/system_docs/2. design/"
    echo "    - ST (UI/API) if acceptance paths changed    → devops/docs/system_docs/3. quality/"
  echo "  N/A is fine for small fixes. This is a judgment call, not a CI gate."
  echo ""

  if [[ ! -t 0 ]]; then
    echo "[git-promote] Non-interactive shell: continuing without confirmation."
    echo "[git-promote] Tip: run interactively, or set SKIP_DOCS_REMINDER=1 to silence this."
    echo ""
    return 0
  fi

  local answer
  read -r -p "[git-promote] Docs assessed (updated or N/A)? Continue promote to ${TARGET_BRANCH}? [y/N] " answer
  case "${answer}" in
    y|Y|yes|YES)
      echo "[git-promote] Continuing promote to ${TARGET_BRANCH}."
      echo ""
      ;;
    *)
      echo "[git-promote] Aborted. Update docs (or confirm N/A), then re-run make git-promote-dev."
      exit 1
      ;;
  esac
}

prompt_docs_reminder_for_dev

if [[ -z "${ALLOW_MERGE_COMMIT}" ]]; then
  # tst / main: point target ref at source SHA (no merge commits on env branches).
  if [[ "${FF_POSSIBLE}" -eq 1 ]]; then
    echo "[git-promote] Fast-forward ${TARGET_BRANCH} to ${SOURCE_BRANCH} (${SHORT_SHA})"
    update_branch_ref "${SOURCE_SHA}" "${TARGET_BRANCH}" 0
  else
    echo "[git-promote] Point ${TARGET_BRANCH} at ${SOURCE_BRANCH} (${SHORT_SHA}) — same SHA"
    update_branch_ref "${SOURCE_SHA}" "${TARGET_BRANCH}" 1
  fi

  NEW_SHA="$(branch_sha "${TARGET_BRANCH}")"
  NEW_SHORT="$(printf '%.7s' "${NEW_SHA}")"
  echo "[git-promote] Done: ${TARGET_BRANCH} is now at ${NEW_SHORT}"
  echo "[git-promote] Same git SHA as ${SOURCE_BRANCH} (${SHORT_SHA})"
  echo "[git-promote] Next: make ${DEPLOY_MAKE_TARGET}"
  exit 0
fi

PR_TITLE="chore(promote): ${SOURCE_BRANCH} → ${TARGET_BRANCH} (${SHORT_SHA})"
read -r -d '' PR_BODY <<EOF || true
Automated branch promotion via \`make git-promote-${PROMOTE_TARGET}\`.

| Field | Value |
|-------|-------|
| Source branch | \`${SOURCE_BRANCH}\` |
| Target branch | \`${TARGET_BRANCH}\` |
| Source SHA | \`${SOURCE_SHA}\` |
| Previous target SHA | \`${TARGET_SHA}\` |
| Release (\`VERSION\`) | \`${VERSION}\` |
| Promoted at (UTC) | ${TIMESTAMP} |
| Fast-forward | $([[ "${FF_POSSIBLE}" -eq 1 ]] && echo yes || echo no — merge commit) |

This PR is created and merged automatically; no manual comment is required.
EOF

find_open_pr() {
  local num
  num="$(gh pr list \
    --repo "${REPO_SLUG}" \
    --base "${TARGET_BRANCH}" \
    --head "${SOURCE_BRANCH}" \
    --state open \
    --json number \
    -q '.[0].number' 2>/dev/null || true)"
  if [[ -n "${num}" && "${num}" != "null" ]]; then
    echo "${num}"
    return
  fi
  gh pr list \
    --repo "${REPO_SLUG}" \
    --base "${TARGET_BRANCH}" \
    --head "${SOURCE_BRANCH}" \
    --state open \
    --limit 1 | awk 'NR==1 { print $1 }'
}

pr_number_from_url() {
  sed -n 's|.*/pull/\([0-9][0-9]*\).*|\1|p' <<<"$1"
}

PR_NUM="$(find_open_pr)"

if [[ -n "${PR_NUM}" && "${PR_NUM}" != "null" ]]; then
  echo "[git-promote] Reusing open PR #${PR_NUM}"
  gh pr edit "${PR_NUM}" --repo "${REPO_SLUG}" --title "${PR_TITLE}" --body "${PR_BODY}"
else
  PR_URL="$(gh pr create \
    --repo "${REPO_SLUG}" \
    --base "${TARGET_BRANCH}" \
    --head "${SOURCE_BRANCH}" \
    --title "${PR_TITLE}" \
    --body "${PR_BODY}")"
  PR_NUM="$(pr_number_from_url "${PR_URL}")"
  if [[ -z "${PR_NUM}" ]]; then
    PR_NUM="$(find_open_pr)"
  fi
  if [[ -z "${PR_NUM}" ]]; then
    echo "[git-promote] ERROR: created PR but could not determine PR number from: ${PR_URL}"
    exit 1
  fi
  echo "[git-promote] Created PR #${PR_NUM}"
fi

merge_pr_with_retry() {
  local pr_num="$1"
  local attempt=1
  local max_attempts=4
  local output=""
  local status=0

  while [[ "${attempt}" -le "${max_attempts}" ]]; do
    set +e
    output="$(gh pr merge "${pr_num}" \
      --repo "${REPO_SLUG}" \
      --merge \
      --admin \
      --delete-branch=false 2>&1)"
    status=$?
    set -e
    if [[ "${status}" -eq 0 ]]; then
      return 0
    fi
    if [[ "${output}" == *"Base branch was modified"* ]] && [[ "${attempt}" -lt "${max_attempts}" ]]; then
      echo "[git-promote] Base branch moved; retrying merge of PR #${pr_num} (${attempt}/${max_attempts})"
      sleep $((attempt * 2))
      attempt=$((attempt + 1))
      continue
    fi
    echo "${output}"
    return "${status}"
  done
}

if [[ "${FF_POSSIBLE}" -eq 1 ]]; then
  echo "[git-promote] Merging PR #${PR_NUM} (fast-forward — same SHA as ${SOURCE_BRANCH})"
else
  echo "[git-promote] Merging PR #${PR_NUM} (merge commit — integration into ${TARGET_BRANCH})"
fi
merge_pr_with_retry "${PR_NUM}"

NEW_SHA="$(branch_sha "${TARGET_BRANCH}")"
NEW_SHORT="$(printf '%.7s' "${NEW_SHA}")"

echo "[git-promote] Done: ${TARGET_BRANCH} is now at ${NEW_SHORT}"
if [[ "${FF_POSSIBLE}" -eq 1 && "${NEW_SHA}" == "${SOURCE_SHA}" ]]; then
  echo "[git-promote] Same git SHA as ${SOURCE_BRANCH} (${SHORT_SHA})"
else
  echo "[git-promote] New merge commit on ${TARGET_BRANCH} (code matches ${SOURCE_BRANCH})"
fi
echo "[git-promote] Next: make ${DEPLOY_MAKE_TARGET}"
