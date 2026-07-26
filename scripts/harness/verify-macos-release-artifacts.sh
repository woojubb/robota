#!/usr/bin/env bash
#
# DIST-002 phase 1 — verify that PUBLISHED macOS release artifacts actually open on a user's Mac.
#
# The question this answers is NOT "did the upload succeed" (which is all the release workflows have
# ever checked) but "is the uploaded thing usable". Those are different questions and only the second
# is what anyone wants from a release pipeline. `v3.0.0-beta.79` shipped a macOS binary that no user
# could open, and the release workflow reported success for four months, because it succeeded at
# uploading.
#
# SCOPE IS DELIBERATELY NARROW. This asserts exactly what a user's machine does to a downloaded
# artifact and nothing more:
#
#   1. the bytes are intact                 (sha256 against the published checksum manifest)
#   2. the signature is structurally valid  (codesign --verify --strict)
#   3. Gatekeeper accepts it                (spctl --assess, with com.apple.quarantine APPLIED)
#   4. it actually runs                     (execute the quarantined binary)
#
# A gate that asserts more than Gatekeeper does goes red on things that do not matter and gets
# disabled. So there are no assertions here about hardened-runtime flags, entitlement contents, or
# certificate subjects — those are means, and this checks the end.
#
# THE QUARANTINE ATTRIBUTE IS THE WHOLE POINT. An ad-hoc signature (which is what `bun build
# --compile` attaches, and what electron-builder produces with no certificate) is accepted by the
# kernel, so a check run on the build runner passes. It is Gatekeeper — which only engages on a file
# carrying com.apple.quarantine, as every browser download does — that refuses it. A check that skips
# the attribute passes on an artifact the user cannot open. This script therefore applies the
# attribute and VERIFIES IT STUCK before assessing; a silently-failing xattr write would make every
# assessment below vacuous.
#
# EXIT 0 only if every BLOCKING check passed. DIAGNOSTIC checks are reported with their real status
# and never affect the exit code; they are labelled as such in the summary so nobody mistakes a
# printed line for an enforced one. `xcrun stapler validate` is DIAGNOSTIC today and becomes BLOCKING
# in DIST-002 phase 2, when notarization exists for it to validate.
#
# Usage: verify-macos-release-artifacts.sh <tag> <download-dir>

set -uo pipefail

TAG="${1:?usage: verify-macos-release-artifacts.sh <tag> <download-dir>}"
DOWNLOAD_DIR="${2:?usage: verify-macos-release-artifacts.sh <tag> <download-dir>}"

BLOCKING_FAILURES=0
BLOCKING_TOTAL=0
SUMMARY_FILE="$(mktemp)"

# ---------------------------------------------------------------------------------------------
# Preconditions. A missing tool must abort, never skip: "SKIPPED" printed under a green check is
# the exact shape this gate exists to prevent.
# ---------------------------------------------------------------------------------------------
for tool in codesign spctl xattr shasum hdiutil xcrun; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FATAL: required tool '$tool' not found — cannot verify. Refusing to report success." >&2
    exit 2
  fi
done

if [ ! -d "$DOWNLOAD_DIR" ]; then
  echo "FATAL: download dir '$DOWNLOAD_DIR' does not exist." >&2
  exit 2
fi

# ---------------------------------------------------------------------------------------------
# Check helpers. `record` is the only place the exit code is decided, so a check cannot be
# accidentally rendered non-enforcing by a stray `|| true` at a call site.
# ---------------------------------------------------------------------------------------------

# record <BLOCKING|DIAGNOSTIC> <PASS|FAIL> <label>
record() {
  local kind="$1" status="$2" label="$3"
  printf '%-10s %-4s %s\n' "$kind" "$status" "$label" >>"$SUMMARY_FILE"
  if [ "$kind" = "BLOCKING" ]; then
    BLOCKING_TOTAL=$((BLOCKING_TOTAL + 1))
    if [ "$status" = "FAIL" ]; then
      BLOCKING_FAILURES=$((BLOCKING_FAILURES + 1))
    fi
  fi
}

# run_check <BLOCKING|DIAGNOSTIC> <label> <cmd...>
run_check() {
  local kind="$1" label="$2"
  shift 2
  echo
  echo "--- [$kind] $label"
  echo "    \$ $*"
  if "$@" 2>&1 | sed 's/^/    /'; then
    record "$kind" "PASS" "$label"
  else
    record "$kind" "FAIL" "$label"
  fi
}

# Applies com.apple.quarantine the way a browser download does, then PROVES the attribute is
# present. Without that proof every Gatekeeper assessment after it would be meaningless.
apply_quarantine() {
  local target="$1"
  echo
  echo "--- [BLOCKING] com.apple.quarantine applied and readable back: $(basename "$target")"
  # Format: <flags>;<hex timestamp>;<agent name>;<uuid> — 0081 is the "downloaded, not yet assessed"
  # flag combination a browser writes.
  xattr -w com.apple.quarantine \
    "0081;$(printf '%x' "$(date +%s)");Safari;$(uuidgen)" "$target" 2>&1 | sed 's/^/    /'
  local value
  value="$(xattr -p com.apple.quarantine "$target" 2>/dev/null)"
  if [ -n "$value" ]; then
    echo "    attribute present: $value"
    record "BLOCKING" "PASS" "quarantine attribute applied: $(basename "$target")"
    return 0
  fi
  echo "    attribute ABSENT after write — every Gatekeeper assessment below would be vacuous."
  record "BLOCKING" "FAIL" "quarantine attribute applied: $(basename "$target")"
  return 1
}

# ---------------------------------------------------------------------------------------------
# Integrity: the published checksum manifest. An artifact with no published checksum is itself a
# finding — a user has no way to tell a truncated download from a complete one, and neither does
# this gate.
# ---------------------------------------------------------------------------------------------
verify_checksum() {
  local file="$1" name manifest
  name="$(basename "$file")"
  echo
  echo "--- [BLOCKING] published checksum matches: $name"

  manifest=""
  for candidate in "$DOWNLOAD_DIR"/SHA256SUMS*.txt; do
    if [ -f "$candidate" ] && grep -q " $name\$" "$candidate"; then
      manifest="$candidate"
      break
    fi
  done

  if [ -z "$manifest" ]; then
    echo "    no published SHA256 manifest covers '$name' — the download is unverifiable."
    record "BLOCKING" "FAIL" "published checksum available: $name"
    return 1
  fi

  local expected actual
  expected="$(grep " $name\$" "$manifest" | awk '{print $1}')"
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  echo "    manifest: $(basename "$manifest")"
  echo "    expected: $expected"
  echo "    actual  : $actual"
  if [ "$expected" = "$actual" ]; then
    record "BLOCKING" "PASS" "published checksum matches: $name"
    return 0
  fi
  record "BLOCKING" "FAIL" "published checksum matches: $name"
  return 1
}

# ---------------------------------------------------------------------------------------------
# A flat Mach-O CLI binary (robota-darwin-*). `--deep` is not used here: it is meaningless for a
# non-bundle and deprecated by Apple.
# ---------------------------------------------------------------------------------------------
verify_cli_binary() {
  local file="$1" name
  name="$(basename "$file")"
  echo
  echo "==============================================================================="
  echo "CLI binary: $name"
  echo "==============================================================================="

  if [ ! -f "$file" ]; then
    record "BLOCKING" "FAIL" "asset present: $name"
    return
  fi
  record "BLOCKING" "PASS" "asset present: $name"

  verify_checksum "$file"
  chmod +x "$file"

  run_check BLOCKING "codesign --verify --strict: $name" \
    codesign --verify --strict --verbose=2 "$file"
  run_check DIAGNOSTIC "codesign -dv (signing identity): $name" \
    codesign -dv --verbose=4 "$file"

  apply_quarantine "$file"

  run_check BLOCKING "spctl --assess --type execute: $name" \
    spctl --assess --type execute --verbose=4 "$file"

  # The user's actual gesture. A quarantined artifact that Gatekeeper rejects may still be launchable
  # from a shell on some macOS versions, so this is asserted independently rather than inferred.
  run_check BLOCKING "quarantined binary executes: $name" "$file" --version
}

# ---------------------------------------------------------------------------------------------
# The desktop .dmg, and the .app inside it. `--deep` IS meaningful here: a bundle's nested code
# (Electron framework, helper apps, and this app's bundled `robota` sidecar) is what notarization
# rejects a bundle over.
# ---------------------------------------------------------------------------------------------
verify_dmg() {
  local file="$1" name mountpoint app
  name="$(basename "$file")"
  echo
  echo "==============================================================================="
  echo "Desktop installer: $name"
  echo "==============================================================================="

  if [ ! -f "$file" ]; then
    record "BLOCKING" "FAIL" "asset present: $name"
    return
  fi
  record "BLOCKING" "PASS" "asset present: $name"

  verify_checksum "$file"
  apply_quarantine "$file"

  run_check BLOCKING "spctl --assess --type install: $name" \
    spctl --assess --type install --verbose=4 "$file"
  run_check DIAGNOSTIC "xcrun stapler validate (BLOCKING once notarized): $name" \
    xcrun stapler validate "$file"

  mountpoint="$(mktemp -d)"
  echo
  echo "--- [BLOCKING] .dmg mounts: $name"
  if hdiutil attach "$file" -nobrowse -readonly -mountpoint "$mountpoint" 2>&1 | sed 's/^/    /'; then
    record "BLOCKING" "PASS" ".dmg mounts: $name"
  else
    record "BLOCKING" "FAIL" ".dmg mounts: $name"
    return
  fi

  app="$(find "$mountpoint" -maxdepth 1 -name '*.app' -print -quit)"
  if [ -z "$app" ]; then
    record "BLOCKING" "FAIL" ".app found inside: $name"
    hdiutil detach "$mountpoint" -quiet
    return
  fi
  record "BLOCKING" "PASS" ".app found inside: $name"

  run_check BLOCKING "codesign --verify --deep --strict: $(basename "$app")" \
    codesign --verify --deep --strict --verbose=2 "$app"
  run_check BLOCKING "spctl --assess --type execute: $(basename "$app")" \
    spctl --assess --type execute --verbose=4 "$app"
  run_check DIAGNOSTIC "codesign -dv (signing identity): $(basename "$app")" \
    codesign -dv --verbose=4 "$app"

  hdiutil detach "$mountpoint" -quiet || hdiutil detach "$mountpoint" -force -quiet
}

# ---------------------------------------------------------------------------------------------

echo "DIST-002 — verifying PUBLISHED macOS artifacts of $TAG"
echo "download dir: $DOWNLOAD_DIR"
echo "macOS: $(sw_vers -productVersion 2>/dev/null || echo unknown)"
ls -la "$DOWNLOAD_DIR"

for asset in robota-darwin-arm64 robota-darwin-x64; do
  verify_cli_binary "$DOWNLOAD_DIR/$asset"
done

shopt -s nullglob
dmgs=("$DOWNLOAD_DIR"/*.dmg)
shopt -u nullglob
if [ ${#dmgs[@]} -eq 0 ]; then
  echo
  echo "--- [BLOCKING] a macOS desktop installer (.dmg) is published for $TAG"
  echo "    no .dmg was downloaded for this tag."
  record "BLOCKING" "FAIL" ".dmg published for $TAG"
else
  for dmg in "${dmgs[@]}"; do
    verify_dmg "$dmg"
  done
fi

echo
echo "==============================================================================="
echo "SUMMARY — $TAG"
echo "==============================================================================="
cat "$SUMMARY_FILE"
rm -f "$SUMMARY_FILE"
echo "-------------------------------------------------------------------------------"
echo "BLOCKING checks: $BLOCKING_TOTAL   failures: $BLOCKING_FAILURES"

if [ "$BLOCKING_TOTAL" -eq 0 ]; then
  echo "VERDICT: FAIL — no blocking check ran at all. A gate that asserts nothing is not a gate."
  exit 1
fi

if [ "$BLOCKING_FAILURES" -gt 0 ]; then
  echo
  echo "VERDICT: FAIL — a user downloading these artifacts cannot open them."
  echo "See .agents/backlog/DIST-002-release-artifact-verification.md for the signing work this needs."
  exit 1
fi

echo "VERDICT: PASS — published macOS artifacts open on a stock Mac."
