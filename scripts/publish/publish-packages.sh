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

# ── Release-run preflight ─────────────────────────────────────
echo "🧾 Checking release-run publish state..."
pnpm harness:release:check -- --version "$VERSION" --publish
echo ""

# ── Detect publishable packages ───────────────────────────────
PUBLISHABLE_PACKAGES=()
while IFS= read -r PACKAGE_NAME; do
  PUBLISHABLE_PACKAGES+=("$PACKAGE_NAME")
done < <(
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
