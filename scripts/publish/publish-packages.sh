#!/usr/bin/env bash
#
# publish-packages.sh — Build, test, publish @robota-sdk packages, and sync dist-tags.
#
# Usage:
#   pnpm publish:beta              # interactive (prompts for OTP)
#   pnpm publish:beta --otp 123456 # non-interactive
#
# What it does:
#   1. Detect version from agent-core/package.json
#   2. Determine prerelease tag (beta, alpha, rc) or "latest"
#   3. Build all publishable packages
#   4. Run tests
#   5. Dry-run publish
#   6. Publish with --tag <prerelease-tag>
#   7. Set "latest" dist-tag to the newly published version
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# ── Parse arguments ───────────────────────────────────────────
OTP=""
for arg in "$@"; do
  case "$arg" in
    --otp=*) OTP="${arg#--otp=}" ;;
    --otp)   shift; OTP="${1:-}" ;;
  esac
done

# ── Detect version and prerelease tag ─────────────────────────
VERSION=$(node -p "require('./packages/agent-core/package.json').version")
echo "📦 Version: $VERSION"

# Extract prerelease tag: "3.0.0-beta.44" → "beta", "3.0.0" → ""
PRE_TAG=""
if [[ "$VERSION" == *-* ]]; then
  PRE_TAG=$(echo "$VERSION" | sed 's/^[^-]*-//' | sed 's/\..*//')
fi

NPM_TAG="${PRE_TAG:-latest}"
echo "🏷️  npm tag: $NPM_TAG"

# ── Collect publishable packages ──────────────────────────────
# All @robota-sdk/* packages that are NOT private
PACKAGES=()
for pkg_json in packages/*/package.json packages/dag-nodes/*/package.json; do
  [ -f "$pkg_json" ] || continue
  is_private=$(node -p "require('./$pkg_json').private || false")
  if [ "$is_private" = "false" ]; then
    pkg_name=$(node -p "require('./$pkg_json').name")
    PACKAGES+=("$pkg_name")
  fi
done

echo "📋 Packages to publish (${#PACKAGES[@]}):"
for p in "${PACKAGES[@]}"; do echo "   - $p"; done
echo ""

# ── Build ─────────────────────────────────────────────────────
echo "🔨 Building packages..."
pnpm build 2>&1 || {
  echo "⚠️  Some packages failed to build. Continuing with publishable ones."
}

# ── Test ──────────────────────────────────────────────────────
echo "🧪 Running tests..."
pnpm test -- --run 2>&1 || {
  echo "❌ Tests failed. Aborting publish."
  exit 1
}

# ── Prompt for OTP if not provided ────────────────────────────
if [ -z "$OTP" ]; then
  echo ""
  read -rp "🔑 Enter npm OTP: " OTP
fi

if [ -z "$OTP" ]; then
  echo "❌ OTP is required."
  exit 1
fi

# ── Dry-run ───────────────────────────────────────────────────
echo ""
echo "🔍 Dry-run..."
for pkg in "${PACKAGES[@]}"; do
  pnpm publish --filter "$pkg" --tag "$NPM_TAG" --no-git-checks --dry-run 2>&1 | tail -3
done

echo ""
read -rp "Proceed with publish? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "❌ Cancelled."
  exit 0
fi

# ── Publish ───────────────────────────────────────────────────
echo ""
echo "🚀 Publishing..."
PUBLISHED=()
for pkg in "${PACKAGES[@]}"; do
  echo "  Publishing $pkg..."
  if pnpm publish --filter "$pkg" --tag "$NPM_TAG" --no-git-checks --otp "$OTP" 2>&1 | tail -1; then
    PUBLISHED+=("$pkg")
  else
    echo "  ⚠️  Failed to publish $pkg (may already exist)"
  fi
done

echo ""
echo "✅ Published ${#PUBLISHED[@]} packages with tag '$NPM_TAG'"

# ── Sync latest dist-tag ─────────────────────────────────────
# When publishing a prerelease (beta/alpha/rc), npm only sets that tag.
# We also want "latest" to point to the newest version so that
# `npm install @robota-sdk/agent-core` gets the current build.
if [ "$NPM_TAG" != "latest" ] && [ ${#PUBLISHED[@]} -gt 0 ]; then
  echo ""
  echo "🏷️  Syncing 'latest' dist-tag → $VERSION"
  for pkg in "${PUBLISHED[@]}"; do
    npm dist-tag add "${pkg}@${VERSION}" latest --otp "$OTP" 2>&1 | head -1
  done
  echo "✅ 'latest' dist-tag updated for ${#PUBLISHED[@]} packages"
fi

echo ""
echo "🎉 Done! Published $VERSION"
