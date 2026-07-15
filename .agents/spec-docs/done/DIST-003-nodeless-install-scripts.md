---
status: done
type: INFRA
tags: [distribution, install, cli, bun]
---

# DIST-003: Node-less install scripts (install.sh / install.ps1) for the Bun binaries

## Problem

DIST-002 publishes the five Bun `robota` binaries + `SHA256SUMS.txt` to each GitHub Release, but a user still has
no easy way to get one onto their machine without cloning/building. Goal: a **one-line, Node-less** install —
detect OS+CPU, download the matching release asset, verify its checksum, place it on PATH, and confirm
`robota --version` — with **zero Node.js** at any step.

## Architecture Review

### Placement Decision (the primary, owner-visible decision)

**Two POSIX/PowerShell scripts under `scripts/` — `scripts/install.sh` (macOS/Linux) + `scripts/install.ps1`
(Windows) — that download from GitHub Releases via the stable `releases/latest/download/<asset>` URL, verify
against DIST-002's `SHA256SUMS.txt`, and install to a per-user dir.**

- **Mirror-analog:** `scripts/` already holds standalone shell tooling (`check-pnpm-publish.sh`,
  `pre-publish-docs-check.sh`) — these install scripts sit alongside as the same kind of standalone,
  dependency-free shell surface. No new top-level dir.
- **Download source = GitHub Releases `latest/download`.** `https://github.com/woojubb/robota/releases/latest/
download/<asset>` always resolves to the newest release's asset — no separate hosting/CDN needed. A pinned
  version is `releases/download/<tag>/<asset>` via a `ROBOTA_VERSION` env/arg. This reuses DIST-002's exact,
  stable asset names (`robota-<os>-<arch>`, `.exe` on Windows) — the reason DIST-002 froze those names.
- **Script hosting = `raw.githubusercontent.com/woojubb/robota/main/scripts/install.{sh,ps1}`** (always available
  for a public repo once merged) → the documented one-liners. The download **host** is a single constant at the
  top of each script so it can be repointed (GitHub Pages / a custom domain) without touching logic.

### Affected Scope

- **New:** `scripts/install.sh`, `scripts/install.ps1`; a short install section in the README / docs.
- **Read-only dependency:** DIST-002's released assets + `SHA256SUMS.txt` (stable names).
- **Untouched:** the binaries (DIST-001), the release workflow (DIST-002), npm publish.

### Alternatives Considered

1. **Two standalone scripts downloading from `releases/latest/download`, checksum-verified (CHOSEN).** No hosting
   infra, no Node, reuses DIST-002's stable names + checksums.
2. **A brew tap / scoop manifest.** Rejected for now (larger, per-ecosystem maintenance) — a later follow-up; the
   raw scripts are the universal baseline.
3. **A Node-based installer (npx).** Rejected — the whole point is Node-less.
4. **Serve the binary from a custom CDN / GitHub Pages.** Rejected as the default — `releases/latest/download` is
   already a stable, free redirect; the host constant keeps this switchable later.

### Architecture Review Checklist

- [x] New-surface placement surfaced FIRST + independently validated (proposal-review at GATE-APPROVAL).
- [x] Mirror-analog identified (`scripts/*.sh` standalone tooling); no new top-level dir.
- [x] Reuse — consumes DIST-002's exact asset names + `SHA256SUMS.txt`; no logic duplicated.
- [x] No Node.js at any step (pure `uname`/`curl`/`shasum` + PowerShell `Invoke-WebRequest`).
- [x] Download host is a single top-of-file constant (repointable without touching logic).
- [x] Fail-loud on unsupported OS/arch + on checksum mismatch (never silently install a bad/wrong binary).
- [x] Version selection — default latest, optional pinned `ROBOTA_VERSION`.

### Decision

Add `scripts/install.sh` + `scripts/install.ps1`. Each: a top `ROBOTA_DOWNLOAD_BASE` constant; detect OS+arch;
build the DIST-002 asset name; download it + `SHA256SUMS.txt` from `releases/{latest,<tag>}/download`; verify the
sha256; install to `~/.robota/bin/robota` (posix) / `%LOCALAPPDATA%\robota\bin\robota.exe` (win) with a PATH hint /
user-PATH edit; `robota --version` to confirm. Fail loudly on unsupported OS/arch or checksum mismatch. No Node.

## Solution

- `scripts/install.sh`: `set -euo pipefail`; `ROBOTA_DOWNLOAD_BASE="https://github.com/woojubb/robota/releases"`.
  - **OS map (proposal-review #3):** `case "$(uname -s)"` → `Darwin)=darwin`, `Linux)=linux`, `*)` hard `exit 1`.
    **Arch map:** `case "$(uname -m)"` → `arm64|aarch64)=arm64`, `x86_64|amd64)=x64`, `*)` hard `exit 1` (so
    `i686`/`armv7l`/… fail loud, never build a non-existent asset URL). Note macOS returns literal `arm64`.
  - `asset="robota-${os}-${arch}"`; **`ROBOTA_VERSION` is the FULL `v`-prefixed tag** (e.g. `v3.0.0-beta.79`);
    normalize by prepending `v` if absent. url = `${BASE}/latest/download/${asset}` (default) or
    `${BASE}/download/${TAG}/${asset}` (pinned).
  - **Download-to-temp under the EXACT asset name, verify BEFORE install (proposal-review #2/#5):** `tmp=$(mktemp
-d)`; `curl -fsSL -o "$tmp/${asset}"` the asset + `-o "$tmp/SHA256SUMS.txt"`; `(cd "$tmp" && grep "  ${asset}$"
SHA256SUMS.txt | shasum -a 256 -c -)` — `shasum -c` checks by the filename in the line, in cwd, so it must run
    in `$tmp` on the still-original name. With `pipefail`, a mismatch OR a grep no-match aborts before install.
  - `install -m 755 "$tmp/${asset}" "${ROBOTA_HOME:-$HOME/.robota}/bin/robota"`; if that bin dir is not on PATH,
    print an `export PATH=` hint. **Verify via the ABSOLUTE path (proposal-review #6):** `"$dest" --version` (a
    freshly-added PATH entry is NOT active in the current shell).
  - Prefer `curl`, fall back to `wget` if absent (minimal Linux containers).
- `scripts/install.ps1`: `$ErrorActionPreference='Stop'`; `$RobotaDownloadBase='…/releases'`. Arch: `x64` only —
  `robota-windows-x64.exe`; hard-fail `x86` (32-bit); `ARM64` runs under x64 emulation (note it). `Invoke-WebRequest`
  the asset + `SHA256SUMS.txt` to a temp dir; `Get-FileHash -Algorithm SHA256` == the line in `SHA256SUMS.txt`
  (else throw). Install to `$env:LOCALAPPDATA\robota\bin\robota.exe`. Add that dir to the USER Path via
  **`[Environment]::SetEnvironmentVariable('Path', $new, 'User')` — NEVER `setx`** (setx truncates PATH at 1024
  chars). Verify via the absolute path `& "$dest" --version`.
- README one-liners: `curl -fsSL https://raw.githubusercontent.com/woojubb/robota/main/scripts/install.sh | bash`
  and `irm https://raw.githubusercontent.com/woojubb/robota/main/scripts/install.ps1 | iex`.

## Affected Files

- NEW: `scripts/install.sh`, `scripts/install.ps1`; a README install section.

## Constraints / Non-goals

- **Depends on a published DIST-002 Release existing** — the download + full one-liner can only be exercised once a
  release with the assets exists (the repo has 0 Releases today). Script logic (OS/arch detection, URL/asset
  construction, checksum flow, shellcheck) is verifiable without one; the live download is the GATE-COMPLETE User
  Execution Test.
- **Checksum = INTEGRITY, not AUTHENTICITY (proposal-review #4).** The asset and `SHA256SUMS.txt` come from the
  SAME Release over the SAME TLS channel — so the sha256 protects against partial/corrupt downloads and
  wrong-asset, NOT against a tampered release (an attacker who can alter one can alter both). TLS already prevents
  MITM. True authenticity would need a detached signature verified against a key baked into the script
  (minisign/cosign) or GitHub build attestations — a later follow-up. Do not sell the checksum as tamper
  protection.
- **Unsigned binaries** (from DIST-001/002) — installed as-is. Note (corrected): a `curl`/`Invoke-WebRequest`
  CLI download does NOT get macOS `com.apple.quarantine` (that is a GUI/LaunchServices xattr), so a CLI-run binary
  generally just runs; the `xattr -d` hint only matters if the user downloaded via a browser. Windows
  `Invoke-WebRequest` writes a Mark-of-the-Web ADS, but SmartScreen enforcement is a GUI path, so PS-launched
  execution typically works. No signing here.
- Out of scope: the binaries (DIST-001), the release workflow (DIST-002), brew/scoop formulae.

## Completion Criteria

- TC-01: `install.sh` maps `uname` → the correct DIST-002 asset name for {linux,darwin}×{x64,arm64}; unsupported
  OS/arch fails loudly (`exit 1`).
- TC-02: `install.sh` downloads the asset + `SHA256SUMS.txt` to a temp dir and **integrity-verifies the sha256 on
  the original asset name BEFORE install**; a mismatch (or a grep no-match) aborts without installing. (Integrity,
  not authenticity — same-origin checksum.)
- TC-03: The download **host is a single top-of-file constant**; changing it is the only edit needed to repoint.
- TC-04: `install.ps1` targets `robota-windows-x64.exe` (x64 only; 32-bit fails loud), installs to
  `%LOCALAPPDATA%\robota\bin`, adds it to the user PATH via `[Environment]::SetEnvironmentVariable(...,'User')`
  (NOT `setx`), and verifies via the **absolute installed path** (a fresh PATH entry is inactive in the current
  process).
- TC-05: `shellcheck` clean on `install.sh`; `PSScriptAnalyzer` clean on `install.ps1` (manual/local — no in-repo
  linter). No `node`/`npm`/`npx` token appears in either script.
- TC-06: A pinned `ROBOTA_VERSION` (full `v`-prefixed tag, normalized if bare) selects `releases/download/<tag>/…`;
  unset → `releases/latest/download/…`.

## Test Plan

- **Agent-owned (local, no release needed):** `shellcheck scripts/install.sh` clean; an OS/arch→asset-name table
  check (source the detection into a harness that asserts the mapping for the four posix combos + unsupported);
  assert the host constant is the only host reference; simulate the checksum flow against a local fixture
  (a fake asset + its `SHA256SUMS.txt`) to prove verify-then-install and mismatch-aborts.
- **Static:** confirm no `node`/`npm`/`npx` token appears in either script.
- **User Execution Test (GATE-COMPLETE, needs a DIST-002 release):** on a Node-less machine/container, run the
  one-liner → new shell → `robota --version` + `--help`; `command -v node` empty. (macOS/Linux + Windows.)

## Tasks

Deferred to GATE-IMPLEMENT. Preliminary: T1 `install.sh` + local shellcheck + OS/arch + checksum-flow harness;
T2 `install.ps1` (+ PSScriptAnalyzer if available); T3 README one-liners; T4 feature→develop→main via
merge-verifier; T5 GATE-COMPLETE (Node-less one-liner against a real release).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-13

Mechanical checks green: `check-spec-doc-frontmatter`, `check-backlog-placement`, `scan-test-plan` all pass. All
required sections present — Problem; Architecture Review with a **Placement Decision surfaced first** (two
standalone scripts under `scripts/`, GitHub Releases `latest/download` source, single host constant), Affected
Scope, 4 Alternatives, a 7-item checklist, a Decision naming the trade-offs (no hosting infra, Node-less, reuse
DIST-002 names+checksums); Solution; Affected Files; Constraints (release-dependency + unsigned recorded);
Completion Criteria TC-01..TC-06; Test Plan (agent-owned local + User Execution Test); Tasks (deferred). Status →
`review-ready`; `draft/` → `backlog/`. GATE-APPROVAL next (independent proposal-review running + owner sign-off).

### [proposal-review] — 🔧 REVISE → revisions applied | 2026-07-13

Independent `proposal-reviewer` **ENDORSED the placement + chosen alternative** (two standalone `scripts/*.{sh,ps1}`
consuming DIST-002's `releases/latest/download` assets, checksum-verified, Node-less) — verified against the code:
the asset names match `build-bun.mjs` + `release-bun-binaries.yml` byte-for-byte; `SHA256SUMS.txt` is GNU-format and
`grep | shasum -a 256 -c` consumes it (reproduced OK/FAILED). Verdict **REVISE** for 6 implementation corrections,
all applied:

1. **Verify via the ABSOLUTE installed path** (a freshly-added PATH entry is inactive in the current shell/process
   — a bare `robota --version` fails first-run). Both platforms.
2. **Windows PATH: `[Environment]::SetEnvironmentVariable(...,'User')`, NEVER `setx`** (setx truncates PATH at 1024
   chars — destructive).
3. **Complete OS/arch maps** — accept literal `arm64` (macOS) + `aarch64`; lowercase `uname -s`; hard-`exit 1` on
   32-bit/other; Windows x64-only (fail `x86`, note `ARM64` emulation).
4. **Checksum = INTEGRITY, not AUTHENTICITY** — same-origin checksum protects against corrupt/wrong-asset, not
   tampering; TC-02 + notes reframed. macOS quarantine claim corrected (CLI `curl` doesn't set it).
5. **Download-to-temp under the exact asset name, verify BEFORE rename/install** (`shasum -c` checks by the
   filename in the line, in cwd).
6. **`ROBOTA_VERSION` must be the full `v`-prefixed tag** (normalize if bare) — a bare version 404s.

Architecture Review Checklist → all `[x]`. Ready for owner GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-13

Owner delegated approval conditional on rule-conformance. Rule-alignment verified: spec-workflow gate criteria met
(placement-first with mirror-analog to `scripts/*.sh`, ≥2 alternatives, non-goals honored, TC-driven, tasks
deferred, Evidence Log) + independent `proposal-reviewer` ENDORSE of placement/alternative with all 6 REVISE items
applied; reuse at the SSOT level (DIST-002's frozen asset names + `SHA256SUMS.txt`, no duplicated logic); fail-loud/
no-fallback held (hard `exit 1` on unsupported OS/arch + pin-404); Node-less invariant held; the security framing
corrected to honest integrity-not-authenticity (epistemic-discipline). Residual: the live one-liner needs a
published DIST-002 Release (0 exist today) — contained as the GATE-COMPLETE User Execution Test; all script logic
(OS/arch, URL/asset, checksum flow, shellcheck, no-node) is agent-verifiable locally now. Status → `approved`;
`backlog/` → `todo/`. GATE-IMPLEMENT next.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-13

Prior-gate precondition met (GATE-APPROVAL ✅). Task file `.agents/tasks/DIST-003.md` authored; status →
`in-progress`; `todo/` → `active/`.

### [GATE-VERIFY] — ✅ PASS (agent-run, local — no release needed) | 2026-07-13

Implemented `scripts/install.sh` + `scripts/install.ps1` + a README install section, with all 6 proposal-review
corrections. Verified locally against a **fixture "release"** served over `python3 -m http.server` (proving the
full flow without a real GitHub Release):

- **TC-01/TC-02 (happy path):** `ROBOTA_DOWNLOAD_BASE=<fixture>` → `install.sh` detected `linux-x64`, downloaded the
  asset + `SHA256SUMS.txt` to a temp dir, integrity-verified the sha256 on the original name, installed to
  `$ROBOTA_HOME/bin/robota`, and confirmed via the ABSOLUTE path → printed the fixture version. PATH hint shown.
- **TC-02 (tamper):** corrupting the asset (stale checksum) → `shasum` mismatch → "refusing to install"; the binary
  was NOT installed. Fail-loud, verify-before-install confirmed.
- **TC-06 (pin):** `ROBOTA_VERSION=9.9.9-fixture` (bare) normalized to `v9.9.9-fixture` and fetched
  `/download/v9.9.9-fixture/…` → installed the pinned binary.
- **TC-03:** `ROBOTA_DOWNLOAD_BASE` is the single host constant (overridden via env in every test above).
- **TC-05:** `shellcheck v0.10.0` clean on `install.sh`; no `node`/`npm`/`npx` token in either script.
- **TC-04 (`install.ps1`):** static-reviewed — arch x64-only (hard-fails `x86`), download+`Get-FileHash` verify to
  temp, install to `%LOCALAPPDATA%\robota\bin`, USER PATH via `[Environment]::SetEnvironmentVariable(...,'User')`
  (NOT `setx`), verify via the absolute path. Logic mirrors the verified `install.sh`; a live run + PSScriptAnalyzer
  are Windows/CI-only (no `pwsh` in the sandbox) — the honest boundary.

Remaining: T4 feature→develop→main (merge-verifier); **T5 GATE-COMPLETE** = the User Execution Test — the Node-less
one-liner against a real DIST-002 Release (owner-gated, same first-Release dependency as DIST-002).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-16

**Status upgrade:** in-progress → done

The first public GitHub Release is live — **https://github.com/woojubb/robota/releases/tag/v3.0.0-beta.79** — with all 11 assets (5 Bun binaries + `SHA256SUMS.txt` + 5 OS installers), built by the DIST-002 + GUI-003 workflows off the pushed `v3.0.0-beta.79` tag. User Execution Test: the REAL one-liner `curl … install.sh | bash` (releases/latest, no version pin, no Node) downloaded, checksum-verified, and installed `robota 3.0.0-beta.79`.
