#!/usr/bin/env sh
# DIST-003 — Node-less installer for the selected CLI (macOS / Linux).
#
# Select the installation script URL from PROJECT_INSTALL_SCRIPT_URL.
#
# Detects OS+CPU, downloads the matching DIST-002 release binary, integrity-verifies its SHA-256, and installs it
# to the configured user state root/bin. Requires NO Node.js — just uname/curl (or wget)/shasum (or sha256sum). POSIX sh.
set -eu

die() {
  echo "install: $1" >&2
  exit 1
}

# The public installer selects Robota unless another product is explicitly configured.
if [ "${PRODUCT_CLI_NAME+x}" != x ] && [ "${PROJECT_RELEASE_BASE_URL+x}" != x ]; then
  PRODUCT_CLI_NAME=__PRODUCT_CLI_NAME__
  PROJECT_RELEASE_BASE_URL=__PROJECT_RELEASE_BASE_URL__
  PRODUCT_USER_STATE_DIR=${PRODUCT_USER_STATE_DIR:-"$HOME/__PRODUCT_PROJECT_STATE_DIR__"}
  PROJECT_RELEASE_TAG_PREFIX=__PROJECT_RELEASE_TAG_PREFIX__
fi
# Explicit selections must provide the complete installation settings.
: "${PROJECT_RELEASE_BASE_URL:?PROJECT_RELEASE_BASE_URL is required}"
: "${PRODUCT_USER_STATE_DIR:?PRODUCT_USER_STATE_DIR is required}"
: "${PRODUCT_CLI_NAME:?PRODUCT_CLI_NAME is required}"
: "${PRODUCT_ARTIFACT_PREFIX:=$PRODUCT_CLI_NAME}"
case "$PRODUCT_CLI_NAME" in *[!A-Za-z0-9._-]*|'') die "invalid PRODUCT_CLI_NAME" ;; esac
case "$PRODUCT_ARTIFACT_PREFIX" in *[!A-Za-z0-9._-]*|'') die "invalid PRODUCT_ARTIFACT_PREFIX" ;; esac
case "$PRODUCT_USER_STATE_DIR" in /*) : ;; *) die "PRODUCT_USER_STATE_DIR must be absolute" ;; esac
case "$PROJECT_RELEASE_BASE_URL" in https://*) : ;; *) die "PROJECT_RELEASE_BASE_URL must use HTTPS" ;; esac
BIN_DIR="$PRODUCT_USER_STATE_DIR/bin"

# ── Detect OS + CPU → the frozen DIST-002 asset name ────────────────────────────────────────────────────────
case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "unsupported OS '$(uname -s)' — only macOS (Darwin) and Linux are supported" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) die "unsupported CPU '$(uname -m)' — only arm64 (aarch64) and x64 (x86_64) are supported" ;;
esac

asset="${PRODUCT_ARTIFACT_PREFIX}-${os}-${arch}"

# ── Version: default latest; a configured tag prefix pins to an explicit release tag. ───────────────────────────────
if [ -n "${PROJECT_RELEASE_VERSION:-}" ]; then
  case "$PROJECT_RELEASE_VERSION" in
    "${PROJECT_RELEASE_TAG_PREFIX:?PROJECT_RELEASE_TAG_PREFIX is required}"*) tag="$PROJECT_RELEASE_VERSION" ;;
    *) tag="$PROJECT_RELEASE_TAG_PREFIX$PROJECT_RELEASE_VERSION" ;;
  esac
  base_url="$PROJECT_RELEASE_BASE_URL/download/$tag"
else
  base_url="$PROJECT_RELEASE_BASE_URL/latest/download"
fi

# ── Downloader: prefer curl, fall back to wget (minimal Linux containers) ────────────────────────────────────
download() {
  # $1 = url, $2 = output path
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "need curl or wget to download"
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "install: downloading $asset ($base_url)"
download "$base_url/$asset" "$tmp/$asset" || die "download failed for $asset (does the release exist?)"
download "$base_url/SHA256SUMS.txt" "$tmp/SHA256SUMS.txt" || die "download failed for SHA256SUMS.txt"

# ── Integrity-verify (NOT authenticity — same-origin checksum) on the ORIGINAL name, in the temp dir ─────────
echo "install: verifying SHA-256"
(
  cd "$tmp" || die "cannot enter temp dir"
  line="$(grep "  $asset\$" SHA256SUMS.txt)" || die "no checksum entry for $asset"
  if command -v shasum >/dev/null 2>&1; then
    printf '%s\n' "$line" | shasum -a 256 -c - >/dev/null
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s\n' "$line" | sha256sum -c - >/dev/null
  else
    die "need shasum or sha256sum to verify the download"
  fi
) || die "checksum mismatch for $asset — refusing to install"

# ── Install (verified) → BIN_DIR/configured-command, then confirm via the ABSOLUTE path ─────────────────────────────────
mkdir -p "$BIN_DIR"
dest="$BIN_DIR/$PRODUCT_CLI_NAME"
install -m 755 "$tmp/$asset" "$dest" 2>/dev/null || {
  cp "$tmp/$asset" "$dest"
  chmod 755 "$dest"
}

echo "install: installed to $dest"
"$dest" --version >/dev/null 2>&1 || die "installed binary failed to run"
"$dest" --version

# A freshly-installed dir is not on PATH in this shell — hint if needed.
case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    echo ""
    echo "install: add $PRODUCT_CLI_NAME to your PATH — append to your shell profile:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac
