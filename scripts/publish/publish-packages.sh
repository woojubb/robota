#!/usr/bin/env bash
#
# publish-packages.sh — Publish all @robota-sdk packages in one shot.
#
# Usage:
#   pnpm publish:beta              # interactive (prompts for OTP)
#   pnpm publish:beta --otp=123456 --tag-otp=654321 # non-interactive
#
# Key design decisions:
#   - Uses `pnpm publish -r` (single command, ~4 seconds) instead of
#     per-package `pnpm publish --filter` (sequential, minutes).
#   - Publishes without --tag so npm sets `latest`, then explicitly syncs
#     the `beta` dist-tag to the same version.
#   - OTP is prompted AFTER dry-run so it doesn't expire before publish.
#   - A fresh OTP may be prompted for dist-tag sync because publish can consume
#     most of the previous OTP window.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# ── Parse arguments ───────────────────────────────────────────
OTP=""
TAG_OTP=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --otp=*) OTP="${1#--otp=}" ;;
    --otp)
      if [ -z "${2:-}" ]; then
        echo "❌ --otp requires a value"
        exit 1
      fi
      OTP="$2"
      shift
      ;;
    --tag-otp=*) TAG_OTP="${1#--tag-otp=}" ;;
    --tag-otp)
      if [ -z "${2:-}" ]; then
        echo "❌ --tag-otp requires a value"
        exit 1
      fi
      TAG_OTP="$2"
      shift
      ;;
    *)
      echo "❌ Unknown argument: $1"
      echo "   Usage: pnpm publish:beta [--otp=123456] [--tag-otp=654321]"
      exit 1
      ;;
  esac
  shift
done

# ── Detect version ────────────────────────────────────────────
VERSION=$(node -p "require('./packages/agent-core/package.json').version")
echo "📦 Version: $VERSION"
echo ""

# ── Detect publishable packages ───────────────────────────────
mapfile -t PUBLISHABLE_PACKAGES < <(
  pnpm -r --depth -1 --json list | node -e '
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const packages = JSON.parse(input);
  for (const packageInfo of packages) {
    if (packageInfo.name?.startsWith("@robota-sdk/") && packageInfo.private === false) {
      console.log(packageInfo.name);
    }
  }
});
'
)

if [ "${#PUBLISHABLE_PACKAGES[@]}" -eq 0 ]; then
  echo "❌ No publishable @robota-sdk packages found."
  exit 1
fi

# ── Auth preflight ────────────────────────────────────────────
echo "🔐 Checking npm authentication..."
if ! NPM_USER=$(npm whoami --registry https://registry.npmjs.org/ 2>/dev/null); then
  echo "❌ npm authentication required before publish."
  echo "   Run: npm login --registry https://registry.npmjs.org/"
  exit 1
fi
echo "✓ npm user: $NPM_USER"
echo ""

# ── Dry-run ───────────────────────────────────────────────────
echo "🔍 Dry-run publish..."
pnpm publish -r --no-git-checks --dry-run 2>&1 | grep -E "^\+ @robota-sdk"
echo ""

# ── Prompt for OTP if not provided ────────────────────────────
if [ -z "$OTP" ]; then
  read -rp "🔑 Enter npm OTP for publish: " OTP
fi

if [ -z "$OTP" ]; then
  echo "❌ OTP is required."
  exit 1
fi

# ── Publish ───────────────────────────────────────────────────
echo ""
echo "🚀 Publishing all packages..."
pnpm publish -r --no-git-checks --otp "$OTP" 2>&1 | grep -E "^\+ @robota-sdk|npm error"

if [ -z "$TAG_OTP" ]; then
  if [ -t 0 ]; then
    echo ""
    read -rp "🔑 Enter fresh npm OTP for beta dist-tags: " TAG_OTP
  else
    TAG_OTP="$OTP"
  fi
fi

if [ -z "$TAG_OTP" ]; then
  echo "❌ OTP is required for beta dist-tag sync."
  exit 1
fi

sync_beta_tag() {
  local package_name="$1"
  local output

  if output=$(npm dist-tag add "$package_name@$VERSION" beta --otp "$TAG_OTP" --registry https://registry.npmjs.org/ 2>&1); then
    echo "$output"
    return 0
  fi

  if printf '%s\n' "$output" | grep -q 'EOTP' && [ -t 0 ]; then
    echo "$output"
    read -rp "🔑 OTP expired while syncing $package_name. Enter fresh npm OTP: " TAG_OTP
    npm dist-tag add "$package_name@$VERSION" beta --otp "$TAG_OTP" --registry https://registry.npmjs.org/
    return 0
  fi

  echo "$output"
  return 1
}

echo ""
echo "🏷️  Syncing beta dist-tags..."
for PACKAGE_NAME in "${PUBLISHABLE_PACKAGES[@]}"; do
  sync_beta_tag "$PACKAGE_NAME"
done

echo ""
echo "🔎 Verifying npm dist-tags..."
for PACKAGE_NAME in "${PUBLISHABLE_PACKAGES[@]}"; do
  LATEST_TAG=$(npm view "$PACKAGE_NAME" dist-tags.latest --registry https://registry.npmjs.org/)
  BETA_TAG=$(npm view "$PACKAGE_NAME" dist-tags.beta --registry https://registry.npmjs.org/)

  if [ "$LATEST_TAG" != "$VERSION" ] || [ "$BETA_TAG" != "$VERSION" ]; then
    echo "❌ Dist-tag mismatch for $PACKAGE_NAME: latest=$LATEST_TAG beta=$BETA_TAG expected=$VERSION"
    exit 1
  fi
done

echo ""
echo "🎉 Done! Published $VERSION"
