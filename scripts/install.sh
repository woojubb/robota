#!/usr/bin/env sh
# DIST-003 — Node-less installer for the `robota` CLI (macOS / Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/woojubb/robota/main/scripts/install.sh | bash
#
# Detects OS+CPU, downloads the matching DIST-002 release binary, integrity-verifies its SHA-256, and installs it
# to ~/.robota/bin. Requires NO Node.js — just uname/curl (or wget)/shasum (or sha256sum). POSIX sh.
set -eu

# ── The ONLY place to change the download host ──────────────────────────────────────────────────────────────
ROBOTA_DOWNLOAD_BASE="${ROBOTA_DOWNLOAD_BASE:-https://github.com/woojubb/robota/releases}"

ROBOTA_HOME="${ROBOTA_HOME:-$HOME/.robota}"
BIN_DIR="$ROBOTA_HOME/bin"

die() {
  echo "install: $1" >&2
  exit 1
}

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

asset="robota-${os}-${arch}"

# ── Version: default latest; ROBOTA_VERSION pins to a full v-prefixed tag (normalize a bare version) ─────────
if [ -n "${ROBOTA_VERSION:-}" ]; then
  case "$ROBOTA_VERSION" in
    v*) tag="$ROBOTA_VERSION" ;;
    *) tag="v$ROBOTA_VERSION" ;;
  esac
  base_url="$ROBOTA_DOWNLOAD_BASE/download/$tag"
else
  base_url="$ROBOTA_DOWNLOAD_BASE/latest/download"
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

# ── Install (verified) → BIN_DIR/robota, then confirm via the ABSOLUTE path ─────────────────────────────────
mkdir -p "$BIN_DIR"
dest="$BIN_DIR/robota"
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
    echo "install: add robota to your PATH — append to your shell profile:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac
