#!/bin/sh
set -eu
cd "$(dirname "$0")"
. ./feature.env
die() { echo "Feature install: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die 'installation requires root during the image build'
[ "$(uname -s)" = Linux ] || die 'only Linux Debian/Ubuntu containers are supported'
version="${VERSION:-$FEATURE_CLI_VERSION}"
. /etc/os-release
case "$ID" in debian|ubuntu) : ;; *) die "unsupported distribution: $ID (Debian/Ubuntu required)" ;; esac
case "$(uname -m)" in x86_64|amd64|arm64|aarch64) : ;; *) die 'unsupported CPU; x64 or arm64 required' ;; esac
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || die 'version must be an exact release, not latest or a range'
method="${INSTALLMETHOD:-binary}"
case "$method" in binary|npm) : ;; *) die 'installMethod must be binary or npm' ;; esac
command_path="/usr/local/bin/$FEATURE_CLI_NAME"
[ ! -e "$command_path" ] || die "$command_path already exists; remove or reconcile that installation explicitly"
remote_user="${_REMOTE_USER:-root}"
remote_uid="$(id -u "$remote_user")"
remote_gid="$(id -g "$remote_user")"
[ ! -L "$FEATURE_STATE_ROOT" ] || die 'state directory must not be a symlink'
if [ -e "$FEATURE_STATE_ROOT" ]; then
  [ "$(stat -c '%u:%g %a' "$FEATURE_STATE_ROOT")" = "$remote_uid:$remote_gid 700" ] || die 'existing state ownership or mode differs; migrate it explicitly before installing'
else
  install -d -m 700 -o "$remote_uid" -g "$remote_gid" "$FEATURE_STATE_ROOT"
fi
mkdir -p "$FEATURE_INSTALL_ROOT" /usr/local/bin
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git bubblewrap
if [ "$method" = binary ]; then
  (
    unset PRODUCT_CLI_NAME PROJECT_RELEASE_BASE_URL PROJECT_RELEASE_TAG_PREFIX
    PRODUCT_USER_STATE_DIR="$FEATURE_INSTALL_ROOT" PRODUCT_ARTIFACT_PREFIX="$FEATURE_ARTIFACT_PREFIX" PROJECT_RELEASE_VERSION="$version" sh ./binary-install.sh
  )
  executable="$FEATURE_INSTALL_ROOT/bin/$FEATURE_CLI_NAME"
else
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || die 'npm method requires an existing Node.js >=22.12 and npm; select a Node Feature first'
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || major===22 && minor<12) process.exit(1)' || die 'npm method requires Node.js >=22.12'
  npm install --global --prefix "$FEATURE_INSTALL_ROOT/npm" --ignore-scripts --omit=dev --no-audit --no-fund "$FEATURE_NPM_PACKAGE@$version"
  executable="$FEATURE_INSTALL_ROOT/npm/bin/$FEATURE_CLI_NAME"
fi
[ -x "$executable" ] || die 'selected installation did not provide the configured CLI executable'
printf "FEATURE_EXECUTABLE='%s'\nFEATURE_STATE_ROOT='%s'\nFEATURE_STATE_VARIABLE='%s'\n" "$executable" "$FEATURE_STATE_ROOT" "$FEATURE_STATE_VARIABLE" > "$FEATURE_INSTALL_ROOT/launcher.env"
chmod 644 "$FEATURE_INSTALL_ROOT/launcher.env"
install -m 755 ./launch.sh "$command_path"
echo "Feature installed. Workspace trust is never granted automatically; use $FEATURE_CLI_NAME trust explicitly."
echo 'Sandbox settings are unchanged. For sandbox.enabled=true in Docker, configure the host profiles/runArgs documented by the product, or deliberately set sandbox.enabled=false. Use the CLI doctor report to inspect containment.'
