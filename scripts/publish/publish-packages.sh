#!/usr/bin/env bash
#
# publish-packages.sh — publish every public package in the selected scope at the release version.
#
# Usage:
#   pnpm publish:beta                     # build, check, publish (prompts for OTP)
#   pnpm publish:beta --otp=123456        # non-interactive
#   pnpm publish:beta --skip-build        # dist is already current (e.g. from CI)
#   pnpm publish:beta --dry-run           # build, check, pack and verify; publish nothing
#   publish-packages.sh --trusted         # from .github/workflows/publish.yml: npm trusted publishing
#
# Publishing is the standard Changesets flow: `changeset publish` runs `pnpm publish` for each public
# package whose version is not on npm yet, so a retry only publishes what is still missing. Packages are
# published under `latest` only: trusted publishing cannot move dist-tags, so there is no `beta` tag.
# A package's first publish cannot be trusted (npm configures trust only for an existing package); it
# goes through the local OTP path.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

PACKAGE_SCOPE="${PRODUCT_PACKAGE_SCOPE:?Set PRODUCT_PACKAGE_SCOPE from the selected product configuration.}"
PROJECT_REPOSITORY_URL="${PROJECT_REPOSITORY_URL:?Set PROJECT_REPOSITORY_URL from the selected product configuration.}"
REGISTRY="${PROJECT_NPM_REGISTRY_URL:?Set PROJECT_NPM_REGISTRY_URL from the selected product configuration.}"
if [[ ! "$PACKAGE_SCOPE" =~ ^@[a-z0-9][a-z0-9._-]*$ ]]; then
  echo "❌ Invalid PRODUCT_PACKAGE_SCOPE." >&2
  exit 1
fi
if [[ "$REGISTRY" != https://* ]]; then
  echo "❌ PROJECT_NPM_REGISTRY_URL must use HTTPS." >&2
  exit 1
fi
export npm_config_registry="$REGISTRY"
if [ -n "${PROJECT_PACKAGE_ACCESS:-}" ]; then
  case "$PROJECT_PACKAGE_ACCESS" in public|restricted) export npm_config_access="$PROJECT_PACKAGE_ACCESS" ;; *)
    echo "❌ PROJECT_PACKAGE_ACCESS must be public or restricted." >&2
    exit 1
    ;;
  esac
fi
OTP=""
SKIP_BUILD="false"
DRY_RUN="false"
TRUSTED="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD="true" ;;
    --dry-run) DRY_RUN="true" ;;
    --otp=*) OTP="${1#--otp=}" ;;
    --otp) OTP="${2:?--otp requires a value}"; shift ;;
    --trusted) TRUSTED="true" ;;
    *)
      echo "❌ Unknown argument: $1"
      echo "   Usage: pnpm publish:beta [--otp=123456] [--skip-build] [--dry-run] [--trusted]"
      exit 1
      ;;
  esac
  shift
done

if [ "$TRUSTED" = "true" ] && [ -n "$OTP" ]; then
  echo "❌ --trusted publishes with the workflow's OIDC credential; it takes no OTP."
  exit 1
fi

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

# Public packages in the selected scope that belong to this lockstep release (name and directory).
PACKAGES=()
PACKAGE_DIRS=()
while IFS=$'\t' read -r NAME DIR; do
  PACKAGES+=("$NAME")
  PACKAGE_DIRS+=("$DIR")
done < <(
  pnpm -r --depth -1 --json list | RELEASE_VERSION="$VERSION" PRODUCT_PACKAGE_SCOPE="$PACKAGE_SCOPE" node -e '
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const scope = process.env.PRODUCT_PACKAGE_SCOPE;
  for (const pkg of JSON.parse(input)) {
    if (pkg.name?.startsWith(`${scope}/`) && pkg.private === false && pkg.version === process.env.RELEASE_VERSION) {
      console.log(`${pkg.name}\t${pkg.path}`);
    }
  }
});
'
)
if [ "${#PACKAGES[@]}" -eq 0 ]; then
  echo "❌ No public packages in $PACKAGE_SCOPE at $VERSION."
  exit 1
fi
echo "📋 ${#PACKAGES[@]} public packages at $VERSION"

# Pack and inspect every tarball before anything reaches the registry.
echo "📦 Packing and verifying tarballs..."
PACK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/package-pack.XXXXXX")
for DIR in "${PACKAGE_DIRS[@]}"; do
  (cd "$DIR" && pnpm pack --pack-destination "$PACK_DIR" >/dev/null)
done
node scripts/publish/verify-tarballs.mjs "$PACK_DIR"

if [ "$DRY_RUN" = "true" ]; then
  echo "Dry run complete (tarballs in $PACK_DIR); nothing was published."
  exit 0
fi

if [ "$TRUSTED" = "true" ]; then
  # A package npm has never seen cannot have a trusted publisher yet, so this run would fail on it
  # after publishing the others. Refuse up front instead.
  NEW=()
  for NAME in "${PACKAGES[@]}"; do
    npm view "$NAME" name --registry "$REGISTRY" >/dev/null 2>&1 || NEW+=("$NAME")
  done
  if [ "${#NEW[@]}" -gt 0 ]; then
    echo "❌ Never published, so not trusted yet: ${NEW[*]}"
    echo "   Publish them once locally with the owner OTP (pnpm publish:beta), configure trust, then rerun."
    exit 1
  fi
else
  echo "🔐 Checking npm authentication..."
  if ! NPM_USER=$(npm whoami --registry "$REGISTRY" 2>/dev/null); then
    echo "❌ Not logged in. Run: npm login --registry $REGISTRY"
    exit 1
  fi
  echo "✓ npm user: $NPM_USER"
fi

echo "🚀 Publishing..."
# Changesets rejects an explicit latest tag while it can see prerelease state.
PRE_STATE="$ROOT_DIR/.changeset/pre.json"
PRE_STATE_LOCK="$ROOT_DIR/.changeset/.publish-prestate-lock"
PRE_STATE_PRESENT="false"
if [ -e "$PRE_STATE" ] || [ -L "$PRE_STATE" ]; then
  if [ ! -f "$PRE_STATE" ] || [ -L "$PRE_STATE" ]; then
    echo "❌ Changesets prerelease state must be a regular file." >&2
    exit 1
  fi
  PRE_STATE_PRESENT="true"
fi
if ! mkdir "$PRE_STATE_LOCK"; then
  echo "❌ Another publication owns the Changesets prerelease state; inspect $PRE_STATE_LOCK before retrying." >&2
  exit 1
fi

restore_pre_state() {
  trap - EXIT HUP INT TERM
  if [ "$PRE_STATE_PRESENT" = "true" ]; then
    if [ -f "$PRE_STATE_LOCK/pre.json" ]; then
      if [ -e "$PRE_STATE" ] || [ -L "$PRE_STATE" ]; then
        echo "❌ Changesets prerelease state reappeared during publication; original preserved in $PRE_STATE_LOCK." >&2
        return 1
      fi
      if ! mv "$PRE_STATE_LOCK/pre.json" "$PRE_STATE"; then
        echo "❌ Could not restore Changesets prerelease state from $PRE_STATE_LOCK." >&2
        return 1
      fi
    elif [ ! -f "$PRE_STATE" ]; then
      echo "❌ Changesets prerelease state is missing; inspect $PRE_STATE_LOCK." >&2
      return 1
    fi
  elif [ -e "$PRE_STATE" ] || [ -L "$PRE_STATE" ]; then
    echo "❌ Changesets prerelease state appeared during publication; inspect $PRE_STATE_LOCK." >&2
    return 1
  fi
  if ! rmdir "$PRE_STATE_LOCK"; then
    echo "❌ Could not remove the Changesets publication lock at $PRE_STATE_LOCK." >&2
    return 1
  fi
}

PUBLISH_PID=""
finish_signal() {
  local status="$1"
  trap '' HUP INT TERM
  if [ -n "$PUBLISH_PID" ]; then
    wait "$PUBLISH_PID" || true
  else
    local child
    for child in $(jobs -pr); do
      wait "$child" || true
    done
  fi
  exit "$status"
}

trap 'status=$?; restore_pre_state || exit 1; exit "$status"' EXIT
trap 'finish_signal 129' HUP
trap 'finish_signal 130' INT
trap 'finish_signal 143' TERM
if [ "$PRE_STATE_PRESENT" = "true" ]; then
  mv "$PRE_STATE" "$PRE_STATE_LOCK/pre.json"
fi

PUBLISH_ARGS=(publish --no-git-tag --tag latest)
if [ -n "$OTP" ]; then
  PUBLISH_ARGS+=(--otp="$OTP")
fi
pnpm changeset "${PUBLISH_ARGS[@]}" <&0 &
PUBLISH_PID=$!
PUBLISH_STATUS=0
wait "$PUBLISH_PID" || PUBLISH_STATUS=$?
PUBLISH_PID=""
if [ "$PUBLISH_STATUS" -ne 0 ]; then
  exit "$PUBLISH_STATUS"
fi
restore_pre_state

# The registry's replicas take minutes to agree after a publish, so a stale `latest` right after
# `changeset publish` is not a failure yet: ask again, uncached, for up to 15 minutes.
echo "🔎 Verifying..."
PENDING=("${PACKAGES[@]}")
for ATTEMPT in $(seq 1 15); do
  STALE=()
  SEEN=()
  for NAME in "${PENDING[@]}"; do
    LATEST=$(npm view "$NAME" dist-tags.latest --prefer-online --registry "$REGISTRY" 2>/dev/null || true)
    if [ "$LATEST" != "$VERSION" ]; then
      STALE+=("$NAME")
      SEEN+=("$NAME latest=${LATEST:-<no answer>}")
    fi
  done
  [ "${#STALE[@]}" -eq 0 ] && break
  PENDING=("${STALE[@]}")
  if [ "$ATTEMPT" -eq 15 ]; then
    echo "❌ latest is not $VERSION after 15 minutes:"
    printf '   %s\n' "${SEEN[@]}"
    exit 1
  fi
  echo "   ${#PENDING[@]} package(s) not yet showing $VERSION; checking again in 60s"
  sleep 60
done

echo "🎉 Published $VERSION"
