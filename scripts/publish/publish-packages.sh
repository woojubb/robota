#!/usr/bin/env bash
#
# publish-packages.sh — publish every public package in the selected scope at the release version.
#
# Usage:
#   pnpm publish:beta                     # build, check, publish; asks for the npm one-time password right
#                                         # before publishing and again when npm rejects an expired code
#   pnpm publish:beta --otp=123456        # non-interactive: the code is used once, nothing is asked
#   pnpm publish:beta --skip-build        # dist is already current (e.g. from CI)
#   pnpm publish:beta --dry-run           # build, check, pack and verify; publish nothing
#   publish-packages.sh --prepare-only --pack-dir <dir> # retain inspected tarballs for retries
#   publish-packages.sh --trusted --pack-dir <dir>      # publish that exact retained artifact
#
# The exact tarballs inspected below are the tarballs sent to npm. A retry skips versions already present,
# then publishes only the missing tarballs. Packages are published under `latest` only: trusted publishing
# cannot move dist-tags, so there is no `beta` tag.
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
export npm_config_fetch_timeout=15000
export npm_config_fetch_retries=0
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
PREPARE_ONLY="false"
PACK_DIR=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD="true" ;;
    --dry-run) DRY_RUN="true" ;;
    --otp=*) OTP="${1#--otp=}" ;;
    --otp) OTP="${2:?--otp requires a value}"; shift ;;
    --trusted) TRUSTED="true" ;;
    --prepare-only) PREPARE_ONLY="true" ;;
    --pack-dir) PACK_DIR="${2:?--pack-dir requires a directory}"; shift ;;
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

# A restored artifact is already built, packed and inspected. Never recreate it on retry.
if [ -z "$PACK_DIR" ] || [ "$PREPARE_ONLY" = "true" ]; then
  if [ "$SKIP_BUILD" != "true" ]; then pnpm build; fi
  node scripts/harness/check-publish-safety.mjs
  node scripts/harness/check-sdk-public-surface.mjs
  PACK_DIR="${PACK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/package-pack.XXXXXX")}"
  mkdir -p "$PACK_DIR"
  while IFS= read -r DIR; do
    (cd "$DIR" && pnpm pack --pack-destination "$PACK_DIR" >/dev/null)
  done < <(
    pnpm -r --depth -1 --json list | RELEASE_VERSION="$VERSION" node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        for (const pkg of JSON.parse(input)) {
          if (pkg.name?.startsWith(process.env.PRODUCT_PACKAGE_SCOPE + "/") &&
              pkg.private === false && pkg.version === process.env.RELEASE_VERSION)
            console.log(pkg.path);
        }
      });
    '
  )
  node scripts/publish/verify-tarballs.mjs "$PACK_DIR"
fi
if [ "$PREPARE_ONLY" = "true" ]; then
  echo "Prepared exact release tarballs in $PACK_DIR."
  exit 0
fi

if [ "$DRY_RUN" = "true" ]; then
  echo "Dry run complete (tarballs in $PACK_DIR); nothing was published."
  exit 0
fi

if [ "$TRUSTED" = "true" ]; then
  node scripts/publish/publish-tarballs.mjs "$PACK_DIR" "$VERSION"
else
  echo "🔐 Checking npm authentication..."
  npm whoami --registry "$REGISTRY" >/dev/null
fi

if [ "$TRUSTED" != "true" ]; then
echo "🚀 Publishing the reviewed tarballs..."
# npm requires a one-time password for every local publish. An interactive run asks immediately before
# the next missing tarball and retries that tarball with a fresh code when npm rejects an expired one.
# Trusted publishing uses the workflow's OIDC identity and never prompts.
PROMPT_OTP="false"
if [ "$TRUSTED" != "true" ] && [ -z "$OTP" ] && [ -t 0 ]; then
  PROMPT_OTP="true"
fi
OTP_ATTEMPTS=4
PUBLISH_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/package-publish.XXXXXX")
trap 'rm -f "$PUBLISH_OUTPUT"' EXIT HUP INT TERM
for TARBALL in "$PACK_DIR"/*.tgz; do
  MANIFEST=$(tar -xzOf "$TARBALL" package/package.json)
  NAME=$(printf '%s' "$MANIFEST" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).name')
  TARBALL_VERSION=$(printf '%s' "$MANIFEST" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
  if npm view "$NAME@$TARBALL_VERSION" version --prefer-online --registry "$REGISTRY" >/dev/null 2>&1; then
    echo "   ✓ $NAME@$TARBALL_VERSION already exists — skip"
    continue
  fi
  PUBLISH_ATTEMPT=1
  while :; do
    if [ "$PROMPT_OTP" = "true" ]; then
      OTP=""
      while [ -z "$OTP" ]; do
        IFS= read -r -s -p "🔑 npm one-time password for $NAME (attempt $PUBLISH_ATTEMPT of $OTP_ATTEMPTS): " OTP
        printf '\n' >&2
      done
    fi
    PUBLISH_ARGS=(publish "$TARBALL" --tag latest --registry "$REGISTRY")
    if [ -n "${PROJECT_PACKAGE_ACCESS:-}" ]; then
      PUBLISH_ARGS+=(--access "$PROJECT_PACKAGE_ACCESS")
    fi
    if [ -n "$OTP" ]; then
      PUBLISH_ARGS+=(--otp="$OTP")
    fi
    : > "$PUBLISH_OUTPUT"
    PUBLISH_STATUS=0
    npm "${PUBLISH_ARGS[@]}" 2>&1 | tee "$PUBLISH_OUTPUT" || PUBLISH_STATUS=$?
    if [ "$PUBLISH_STATUS" -eq 0 ]; then
      break
    fi
    if [ "$PROMPT_OTP" != "true" ] || [ "$PUBLISH_ATTEMPT" -ge "$OTP_ATTEMPTS" ] \
      || ! grep -q EOTP "$PUBLISH_OUTPUT"; then
      exit "$PUBLISH_STATUS"
    fi
    echo "⚠️  npm rejected the one-time password; retrying this unpublished tarball with a fresh code."
    PUBLISH_ATTEMPT=$((PUBLISH_ATTEMPT + 1))
  done
done
rm -f "$PUBLISH_OUTPUT"
trap - EXIT HUP INT TERM

fi

if [ -n "${RELEASE_INTEGRITY_MANIFEST:-}" ]; then
  echo "🔐 Binding registry tarballs to the reviewed release source..."
  node scripts/publish/generate-integrity-manifest.mjs "$PACK_DIR" "$RELEASE_INTEGRITY_MANIFEST"
fi

echo "🎉 Published $VERSION"
