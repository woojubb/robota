#!/usr/bin/env bash
#
# publish-packages.sh — publish every public @robota-sdk package at the release version.
#
# Usage:
#   pnpm publish:beta                                  # build, check, publish (prompts for OTP)
#   pnpm publish:beta --otp=123456 --tag-otp=654321    # non-interactive
#   pnpm publish:beta --skip-build                     # dist is already current (e.g. from CI)
#   pnpm publish:beta --dry-run                        # build, check, pack and verify; publish nothing
#
# Publishing is the standard Changesets flow: `changeset publish` runs `pnpm publish` for each public
# package whose version is not on npm yet, so a retry only publishes what is still missing. Packages are
# published under `latest`; the `beta` dist-tag is then pointed at the same version.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

REGISTRY=https://registry.npmjs.org/
OTP=""
TAG_OTP=""
SKIP_BUILD="false"
DRY_RUN="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD="true" ;;
    --dry-run) DRY_RUN="true" ;;
    --otp=*) OTP="${1#--otp=}" ;;
    --otp) OTP="${2:?--otp requires a value}"; shift ;;
    --tag-otp=*) TAG_OTP="${1#--tag-otp=}" ;;
    --tag-otp) TAG_OTP="${2:?--tag-otp requires a value}"; shift ;;
    *)
      echo "❌ Unknown argument: $1"
      echo "   Usage: pnpm publish:beta [--otp=123456] [--tag-otp=654321] [--skip-build] [--dry-run]"
      exit 1
      ;;
  esac
  shift
done

VERSION=$(node -p "require('./packages/agent-core/package.json').version")
echo "📦 Version: $VERSION"

if [ "$SKIP_BUILD" = "true" ]; then
  echo "🛠️  Skipping build (--skip-build)."
else
  echo "🛠️  Building..."
  pnpm build
fi

echo "🔎 Release checks..."
node scripts/harness/check-publish-safety.mjs
node scripts/harness/check-sdk-public-surface.mjs

# Public packages that belong to this lockstep release (name and directory).
PACKAGES=()
PACKAGE_DIRS=()
while IFS=$'\t' read -r NAME DIR; do
  PACKAGES+=("$NAME")
  PACKAGE_DIRS+=("$DIR")
done < <(
  pnpm -r --depth -1 --json list | RELEASE_VERSION="$VERSION" node -e '
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  for (const pkg of JSON.parse(input)) {
    if (pkg.name?.startsWith("@robota-sdk/") && pkg.private === false && pkg.version === process.env.RELEASE_VERSION) {
      console.log(`${pkg.name}\t${pkg.path}`);
    }
  }
});
'
)
if [ "${#PACKAGES[@]}" -eq 0 ]; then
  echo "❌ No public @robota-sdk packages at $VERSION."
  exit 1
fi
echo "📋 ${#PACKAGES[@]} public packages at $VERSION"

# Pack and inspect every tarball before anything reaches the registry.
echo "📦 Packing and verifying tarballs..."
PACK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/robota-pack.XXXXXX")
for DIR in "${PACKAGE_DIRS[@]}"; do
  (cd "$DIR" && pnpm pack --pack-destination "$PACK_DIR" >/dev/null)
done
node scripts/publish/verify-tarballs.mjs "$PACK_DIR"

if [ "$DRY_RUN" = "true" ]; then
  echo "Dry run complete (tarballs in $PACK_DIR); nothing was published."
  exit 0
fi

echo "🔐 Checking npm authentication..."
if ! NPM_USER=$(npm whoami --registry "$REGISTRY" 2>/dev/null); then
  echo "❌ Not logged in. Run: npm login --registry $REGISTRY"
  exit 1
fi
echo "✓ npm user: $NPM_USER"

echo "🚀 Publishing..."
PUBLISH_ARGS=(publish --no-git-tag)
if [ -n "$OTP" ]; then
  PUBLISH_ARGS+=(--otp="$OTP")
fi
pnpm changeset "${PUBLISH_ARGS[@]}"

if [ -z "$TAG_OTP" ]; then
  if [ -t 0 ]; then
    read -rp "🔑 Enter a fresh npm OTP for the beta dist-tags: " TAG_OTP
  else
    TAG_OTP="$OTP"
  fi
fi
if [ -z "$TAG_OTP" ]; then
  echo "❌ An OTP is required for the beta dist-tag sync."
  exit 1
fi

# Parallel so the whole sync fits in one OTP window.
echo "🏷️  Syncing beta dist-tags..."
PIDS=()
for NAME in "${PACKAGES[@]}"; do
  npm dist-tag add "$NAME@$VERSION" beta --otp "$TAG_OTP" --registry "$REGISTRY" >/dev/null 2>&1 &
  PIDS+=("$!")
done
FAILED=()
for INDEX in "${!PACKAGES[@]}"; do
  wait "${PIDS[$INDEX]}" || FAILED+=("${PACKAGES[$INDEX]}")
done
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "⚠️  dist-tag failed for: ${FAILED[*]}"
  if [ ! -t 0 ]; then
    echo "❌ Re-run with a fresh --tag-otp, or interactively."
    exit 1
  fi
  read -rp "🔑 Enter a fresh npm OTP to retry: " TAG_OTP
  for NAME in "${FAILED[@]}"; do
    npm dist-tag add "$NAME@$VERSION" beta --otp "$TAG_OTP" --registry "$REGISTRY"
  done
fi

echo "🔎 Verifying dist-tags..."
for NAME in "${PACKAGES[@]}"; do
  LATEST=$(npm view "$NAME" dist-tags.latest --registry "$REGISTRY")
  BETA=$(npm view "$NAME" dist-tags.beta --registry "$REGISTRY")
  if [ "$LATEST" != "$VERSION" ] || [ "$BETA" != "$VERSION" ]; then
    echo "❌ $NAME: latest=$LATEST beta=$BETA expected=$VERSION"
    exit 1
  fi
done

echo "🎉 Published $VERSION"
