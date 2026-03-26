#!/usr/bin/env bash
#
# publish-packages.sh — Publish all @robota-sdk packages in one shot.
#
# Usage:
#   pnpm publish:beta              # interactive (prompts for OTP)
#   pnpm publish:beta --otp 123456 # non-interactive
#
# Key design decisions:
#   - Uses `pnpm publish -r` (single command, ~4 seconds) instead of
#     per-package `pnpm publish --filter` (sequential, minutes).
#   - No --tag flag: npm automatically sets `latest` to the new version.
#     No manual dist-tag sync needed.
#   - OTP is prompted AFTER dry-run so it doesn't expire during build/test.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# ── Parse arguments ───────────────────────────────────────────
OTP=""
for arg in "$@"; do
  case "$arg" in
    --otp=*) OTP="${arg#--otp=}" ;;
  esac
done

# ── Detect version ────────────────────────────────────────────
VERSION=$(node -p "require('./packages/agent-core/package.json').version")
echo "📦 Version: $VERSION"
echo ""

# ── Dry-run ───────────────────────────────────────────────────
echo "🔍 Dry-run publish..."
pnpm publish -r --no-git-checks --dry-run 2>&1 | grep -E "^\+ @robota-sdk"
echo ""

# ── Prompt for OTP if not provided ────────────────────────────
if [ -z "$OTP" ]; then
  read -rp "🔑 Enter npm OTP: " OTP
fi

if [ -z "$OTP" ]; then
  echo "❌ OTP is required."
  exit 1
fi

# ── Publish ───────────────────────────────────────────────────
echo ""
echo "🚀 Publishing all packages..."
pnpm publish -r --no-git-checks --otp "$OTP" 2>&1 | grep -E "^\+ @robota-sdk|npm error"

echo ""
echo "🎉 Done! Published $VERSION"
