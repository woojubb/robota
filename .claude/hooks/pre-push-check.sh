#!/bin/bash
# pre-push-check.sh
# Before git push: ensure pnpm-lock.yaml is up-to-date with all package.json files.
# Blocks push if lockfile is dirty or out of sync.
# Runs as a PreToolUse hook on Bash tool calls.

set -euo pipefail

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

# Only intercept git push commands
echo "$COMMAND" | grep -qE '^\s*git\s+(push)(\s|$)' || exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# 1. Block if pnpm-lock.yaml already has uncommitted changes
if ! git -C "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml has uncommitted changes. Commit the lockfile before pushing." >&2
  exit 2
fi

if ! git -C "$PROJECT_DIR" diff --cached --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is staged but not committed. Commit it first." >&2
  exit 2
fi

# 2. Run pnpm install (prefer-offline for speed) and check if lockfile would change
cd "$PROJECT_DIR"
pnpm install --prefer-offline --silent 2>/dev/null || pnpm install --silent 2>/dev/null || true

if ! git -C "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is out of sync with package.json files." >&2
  echo "[pre-push-check] Run: pnpm install && git add pnpm-lock.yaml && git commit -m 'chore: update lockfile'" >&2
  # Restore original lockfile to avoid unintended changes
  git -C "$PROJECT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true
  exit 2
fi

exit 0
