#!/bin/sh
set -eu
. '__FEATURE_LAUNCHER_CONFIG__'
state="${PRODUCT_USER_STATE_DIR:-$FEATURE_STATE_ROOT}"
owner="$(id -u):$(id -g)"
if [ ! -d "$state" ] || [ "$(stat -c '%u:%g %a' "$state" 2>/dev/null || true)" != "$owner 700" ] || [ ! -w "$state" ]; then
  echo "Feature state '$state' must be private (0700), writable and owned by $owner. Nothing was changed." >&2
  echo 'A changed remote-user UID/GID requires explicit state-volume migration: verify the named volume with docker volume inspect, then migrate its owner and permissions as described in the Feature README. Do not delete the volume to repair ownership.' >&2
  exit 1
fi
export PRODUCT_USER_STATE_DIR="$state"
exec "$FEATURE_EXECUTABLE" "$@"
