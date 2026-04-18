#!/bin/bash
# pre-push-check.sh
# Before git push: run the same checks as CI to catch failures before they reach remote.
# 1. Verify pnpm-lock.yaml is in sync
# 2. Run typecheck, lint, and tests
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

echo "[pre-push-check] Running pre-push CI checks..." >&2

# ── 1. Lockfile sync check ──────────────────────────────────────────────────

if ! git -C "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml has uncommitted changes. Commit the lockfile before pushing." >&2
  exit 2
fi

if ! git -C "$PROJECT_DIR" diff --cached --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is staged but not committed. Commit it first." >&2
  exit 2
fi

cd "$PROJECT_DIR"

pnpm install --prefer-offline --silent 2>/dev/null || pnpm install --silent 2>/dev/null || true

if ! git -C "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is out of sync with package.json files." >&2
  echo "[pre-push-check] Run: pnpm install && git add pnpm-lock.yaml && git commit -m 'chore: update lockfile'" >&2
  git -C "$PROJECT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true
  exit 2
fi

# ── 2. Typecheck ────────────────────────────────────────────────────────────

echo "[pre-push-check] Running typecheck..." >&2
if ! pnpm run typecheck --silent 2>&1 | grep -qE "^$|Done$|SyntaxError|error TS"; then
  : # suppress output, check exit code below
fi

if ! pnpm run typecheck 2>&1; then
  echo "[pre-push-check] Blocked: typecheck failed. Fix type errors before pushing." >&2
  exit 2
fi

# ── 3. Lint ─────────────────────────────────────────────────────────────────

echo "[pre-push-check] Running lint..." >&2
if ! pnpm run lint 2>&1; then
  echo "[pre-push-check] Blocked: lint failed. Fix lint errors before pushing." >&2
  exit 2
fi

# ── 4. Tests ────────────────────────────────────────────────────────────────

echo "[pre-push-check] Running tests..." >&2
if ! pnpm run test 2>&1; then
  echo "[pre-push-check] Blocked: tests failed. Fix failing tests before pushing." >&2
  exit 2
fi

echo "[pre-push-check] All checks passed. Proceeding with push." >&2
exit 0
