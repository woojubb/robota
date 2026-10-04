#!/usr/bin/env bash
#
# pack-local.sh — pack this checkout's CLI into docker/robota/local-packages/ for
# `docker build --build-arg ROBOTA_SOURCE=local`. Pre-release verification only: a deployed image
# installs a published release.
#
# Usage:
#   docker/robota/pack-local.sh               # build the CLI and its workspace dependencies, then pack
#   docker/robota/pack-local.sh --skip-build  # dist is already current
#
# The CLI bundles all Robota workspace code and depends only on third-party packages, so its tarball
# is the whole install. It is packed with `pnpm pack`, as the release does
# (scripts/publish/publish-packages.sh).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$SCRIPT_DIR/local-packages"
CLI_PACKAGE="${PRODUCT_PACKAGE_SCOPE:-@robota-sdk}/agent-cli"

SKIP_BUILD="false"
for ARG in "$@"; do
  case "$ARG" in
    --skip-build) SKIP_BUILD="true" ;;
    *)
      echo "Unknown argument: $ARG (usage: pack-local.sh [--skip-build])" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"
if [ "$SKIP_BUILD" = "false" ]; then
  pnpm --filter "$CLI_PACKAGE..." build
fi

mkdir -p "$OUT_DIR"
find "$OUT_DIR" -maxdepth 1 -name '*.tgz' -exec rm -f {} +
CLI_DIR="$(pnpm --filter "$CLI_PACKAGE" exec pwd)"
(cd "$CLI_DIR" && pnpm pack --pack-destination "$OUT_DIR" >/dev/null)

echo "Packed $(cd "$OUT_DIR" && ls ./*.tgz) into $OUT_DIR"
echo "Build: docker build --build-arg ROBOTA_SOURCE=local -t robota:local $SCRIPT_DIR"
