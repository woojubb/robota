# DIST-003 — Node-less install scripts (install.sh / install.ps1)

Spec: `.agents/spec-docs/active/DIST-003-nodeless-install-scripts.md` (status: in-progress).
Owner approved 2026-07-13 (rule-conformance delegated; proposal-review ENDORSE + 6 REVISE applied). Depends on
DIST-002 (done).

`scripts/install.{sh,ps1}` detect OS+CPU, download the matching DIST-002 release binary, integrity-verify the
sha256, install to a per-user PATH dir, confirm `robota --version`. Node-less. Download host = one top-of-file
constant; `ROBOTA_VERSION` pins a full `v`-tag.

## Tasks

- [x] T1: `scripts/install.sh` — OS/arch maps (Darwin/Linux; arm64/aarch64, x86_64/amd64; else exit 1),
      download-to-temp + verify-before-install, absolute-path `--version`, curl/wget fallback, host constant.
      shellcheck v0.10.0 clean.
- [x] T2: `scripts/install.ps1` — x64-only (fail x86), Get-FileHash verify, `SetEnvironmentVariable(...,'User')`
      (not setx), absolute-path verify. (PSScriptAnalyzer/live = Windows/CI.)
- [x] T3: README one-liners (curl | bash / irm | iex).
- [ ] T4: feature→develop→main via merge-verifier.
- [ ] T5 (GATE-COMPLETE): User Execution Test — Node-less one-liner against a real DIST-002 Release; record evidence.

## Test Plan

- **Agent-owned (local, no release):** fixture "release" over `python3 -m http.server` proved the full
  `install.sh` flow — download → sha256 verify → install → absolute-path `--version` (TC-01/02); tamper → checksum
  abort, no install (TC-02); bare `ROBOTA_VERSION` normalizes to `v`-tag + `/download/<tag>/` (TC-06);
  `ROBOTA_DOWNLOAD_BASE` is the only host reference (TC-03).
- **Static:** `shellcheck` clean; no `node`/`npm`/`npx` token (TC-05); `install.ps1` static-reviewed (TC-04).
- **User Execution Test (T5, needs a DIST-002 Release):** Node-less machine → one-liner → new shell →
  `robota --version`/`--help`; `command -v node` empty.
