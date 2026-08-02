#!/usr/bin/env bash
# Stop hook for Komfy. Nudges Claude to propose a Conventional Commits name
# (and, on develop/main, a branch name) whenever the working tree has changed
# and that exact state has not been nudged yet.
#
# Strictly read-only: it NEVER runs any git write command (CLAUDE.md rule).
# Guards against loops via stop_hook_active + a per-state dedupe marker kept
# OUTSIDE the repo (so the marker itself never dirties the tree).
set -euo pipefail

input="$(cat)"

# 1. Loop guard: if we're already inside a stop-hook continuation, let it stop.
stop_active="$(printf '%s' "$input" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("stop_hook_active",False))' \
  2>/dev/null || echo False)"
[ "$stop_active" = "True" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# 2. Nothing changed in the working tree -> nothing to propose.
status="$(git status --porcelain 2>/dev/null || true)"
[ -z "$status" ] && exit 0

# 3. Dedupe: nudge only once per distinct working-tree state. The marker lives
#    in the temp dir, keyed by repo path, so it never shows up in git status.
repo_key="$(pwd | shasum | cut -d' ' -f1)"
marker="${TMPDIR:-/tmp}/komfy-commit-nudge-${repo_key}"
state_hash="$(printf '%s' "$status" | shasum | cut -d' ' -f1)"
if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$state_hash" ]; then
  exit 0
fi
printf '%s' "$state_hash" > "$marker" 2>/dev/null || true

# 4. Build the reminder, branch-aware.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ "$branch" = "develop" ] || [ "$branch" = "main" ]; then
  reason="The working tree has uncommitted changes on '$branch' — work should not land directly on $branch. Before finishing, invoke the branch-name skill: it proposes an English branch name AND the Conventional Commits message. Propose only; never commit, switch, or create the branch."
else
  reason="The working tree has uncommitted changes. Before finishing, invoke the conventional-commit skill to propose an English Conventional Commits subject line. Propose only; never commit or stage."
fi

python3 -c 'import json,sys;print(json.dumps({"decision":"block","reason":sys.argv[1]}))' "$reason"
exit 0
