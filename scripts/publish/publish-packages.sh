#!/usr/bin/env bash
#
# publish-packages.sh — Publish all @robota-sdk packages in one shot.
#
# Usage:
#   pnpm publish:beta              # interactive (builds, checks, then prompts for OTP)
#   pnpm publish:beta --otp=123456 --tag-otp=654321 # non-interactive
#   pnpm publish:beta --skip-build # skip the build preflight (dist already current, e.g. from CI)
#
# Key design decisions:
#   - Uses `pnpm publish -r` (single command, ~4 seconds) instead of
#     per-package `pnpm publish --filter` (sequential, minutes).
#   - Publishes without --tag so npm sets `latest`, then explicitly syncs
#     the `beta` dist-tag to the same version (in parallel, to fit one OTP window).
#   - ALL slow, OTP-free work (build, release-run check, auth, dry-run) runs BEFORE
#     the OTP prompt, so entering the OTP runs the publish to completion at once.
#   - Only packages at THIS release's VERSION are targeted (independently-versioned
#     packages are excluded), so the exposure-wait never hangs on a version that
#     will not publish.
#   - A fresh OTP may still be prompted for dist-tag sync if the publish window closes.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# ── Parse arguments ───────────────────────────────────────────
OTP=""
TAG_OTP=""
SKIP_BUILD="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD="true" ;;
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

# ── Build preflight (before any OTP, so the OTP → publish step is immediate) ──
# All slow, OTP-free work happens here; entering the OTP later should run to completion at once.
if [ "$SKIP_BUILD" = "true" ]; then
  echo "🛠️  Skipping build (--skip-build); assuming dist is already current."
else
  echo "🛠️  Building all packages (turbo-cached)..."
  pnpm build
fi
echo ""

# ── Release-run preflight ─────────────────────────────────────
echo "🧾 Checking release-run publish state..."
pnpm harness:release:check -- --version "$VERSION" --publish
echo ""

# ── Detect publishable packages ───────────────────────────────
# Target ONLY packages at THIS release's VERSION. Independently-versioned packages (e.g.
# agent-process at an older beta) are private:false but not part of this lockstep release; including
# them made the exposure-wait hang on a `<pkg>@VERSION` that never publishes (INFRA-029).
PUBLISHABLE_PACKAGES=()
while IFS= read -r PACKAGE_NAME; do
  PUBLISHABLE_PACKAGES+=("$PACKAGE_NAME")
done < <(
  pnpm -r --depth -1 --json list | RELEASE_VERSION="$VERSION" node -e '
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const version = process.env.RELEASE_VERSION;
  const packages = JSON.parse(input);
  for (const packageInfo of packages) {
    if (
      packageInfo.name?.startsWith("@robota-sdk/") &&
      packageInfo.private === false &&
      packageInfo.version === version
    ) {
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

PUBLISHED_PACKAGES=()
MISSING_PACKAGES=()

version_is_published() {
  local package_name="$1"
  local published_version

  if ! published_version=$(npm view "$package_name@$VERSION" version --registry https://registry.npmjs.org/ 2>/dev/null); then
    return 1
  fi

  [ "$published_version" = "$VERSION" ]
}

refresh_publish_state() {
  local package_name

  PUBLISHED_PACKAGES=()
  MISSING_PACKAGES=()
  for package_name in "${PUBLISHABLE_PACKAGES[@]}"; do
    if version_is_published "$package_name"; then
      PUBLISHED_PACKAGES+=("$package_name")
    else
      MISSING_PACKAGES+=("$package_name")
    fi
  done
}

print_publish_state() {
  echo "📋 Publish state: ${#PUBLISHED_PACKAGES[@]} already published, ${#MISSING_PACKAGES[@]} pending"
  if [ "${#PUBLISHED_PACKAGES[@]}" -gt 0 ]; then
    echo "   Already published packages will be skipped on retry."
  fi
}

wait_for_registry_publish_state() {
  local attempt

  for attempt in 1 2 3 4 5 6; do
    if [ "${#MISSING_PACKAGES[@]}" -eq 0 ]; then
      return 0
    fi

    echo "⏳ Waiting for npm registry to expose ${#MISSING_PACKAGES[@]} package(s) (attempt $attempt/6)..."
    sleep 5
    refresh_publish_state
  done
}

run_publish_command() {
  local mode="$1"
  local output
  local status
  local package_name
  local -a command

  command=(pnpm)
  if [ "${#MISSING_PACKAGES[@]}" -eq "${#PUBLISHABLE_PACKAGES[@]}" ]; then
    command+=(publish -r --no-git-checks)
  else
    for package_name in "${MISSING_PACKAGES[@]}"; do
      command+=(--filter "$package_name")
    done
    command+=(publish --no-git-checks)
  fi

  if [ "$mode" = "dry-run" ]; then
    command+=(--dry-run)
  else
    command+=(--otp "$OTP")
  fi

  set +e
  output=$("${command[@]}" 2>&1)
  status=$?
  set -e

  printf '%s\n' "$output" | grep -E "^\+ @robota-sdk|npm error|previously published|You cannot publish over" || true
  if [ "$status" -ne 0 ]; then
    printf '%s\n' "$output" >&2
  fi

  return "$status"
}

# ── Auth preflight ────────────────────────────────────────────
echo "🔐 Checking npm authentication..."
if ! NPM_USER=$(npm whoami --registry https://registry.npmjs.org/ 2>/dev/null); then
  echo "❌ npm authentication required before publish."
  echo "   Run: npm login --registry https://registry.npmjs.org/"
  exit 1
fi
echo "✓ npm user: $NPM_USER"
echo ""

refresh_publish_state
print_publish_state
echo ""

# ── Dry-run ───────────────────────────────────────────────────
if [ "${#MISSING_PACKAGES[@]}" -gt 0 ]; then
  echo "🔍 Dry-run publish..."
  run_publish_command dry-run
  echo ""
fi

# ── Prompt for OTP if not provided ────────────────────────────
if [ "${#MISSING_PACKAGES[@]}" -gt 0 ] && [ -z "$OTP" ]; then
  read -rp "🔑 Enter npm OTP for publish: " OTP
fi

if [ "${#MISSING_PACKAGES[@]}" -gt 0 ] && [ -z "$OTP" ]; then
  echo "❌ OTP is required."
  exit 1
fi

# ── Publish ───────────────────────────────────────────────────
while [ "${#MISSING_PACKAGES[@]}" -gt 0 ]; do
  echo ""
  echo "🚀 Publishing ${#MISSING_PACKAGES[@]} pending package(s)..."
  if run_publish_command publish; then
    refresh_publish_state
    wait_for_registry_publish_state
    print_publish_state
    if [ "${#MISSING_PACKAGES[@]}" -eq 0 ]; then
      break
    fi

    if [ -t 0 ]; then
      echo ""
      read -rp "🔑 Publish completed but registry still has pending packages. Enter fresh npm OTP to retry: " OTP
      continue
    fi

    echo "❌ Publish completed but npm registry still does not expose all packages."
    exit 1
  fi

  refresh_publish_state
  print_publish_state
  if [ "${#MISSING_PACKAGES[@]}" -eq 0 ]; then
    break
  fi

  if [ -t 0 ]; then
    echo ""
    read -rp "🔑 Publish OTP expired. Enter fresh npm OTP for remaining packages: " OTP
    continue
  fi

  echo "❌ Publish failed before all packages were published."
  exit 1
done

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

add_beta_tag() {
  npm dist-tag add "$1@$VERSION" beta --otp "$TAG_OTP" --registry https://registry.npmjs.org/
}

# Issue all dist-tag adds concurrently so publish + tag sync finish inside one OTP window
# (sequential ~19 calls alone could outlast a 30s window and demand another OTP). INFRA-029.
echo ""
echo "🏷️  Syncing beta dist-tags (parallel)..."
TAG_PIDS=()
for PACKAGE_NAME in "${PUBLISHABLE_PACKAGES[@]}"; do
  add_beta_tag "$PACKAGE_NAME" >/dev/null 2>&1 &
  TAG_PIDS+=("$!")
done

FAILED_TAGS=()
IDX=0
for PACKAGE_NAME in "${PUBLISHABLE_PACKAGES[@]}"; do
  if ! wait "${TAG_PIDS[$IDX]}"; then
    FAILED_TAGS+=("$PACKAGE_NAME")
  fi
  IDX=$((IDX + 1))
done

# Retry any failures (typically an expired OTP) with a fresh OTP when interactive.
if [ "${#FAILED_TAGS[@]}" -gt 0 ]; then
  echo "⚠️  ${#FAILED_TAGS[@]} dist-tag(s) failed: ${FAILED_TAGS[*]}"
  if [ -t 0 ]; then
    read -rp "🔑 Enter fresh npm OTP to retry the failed dist-tag(s): " TAG_OTP
    for PACKAGE_NAME in "${FAILED_TAGS[@]}"; do
      add_beta_tag "$PACKAGE_NAME"
    done
  else
    echo "❌ dist-tag sync failed (pass a fresh --tag-otp, or run interactively to retry)."
    exit 1
  fi
fi

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
