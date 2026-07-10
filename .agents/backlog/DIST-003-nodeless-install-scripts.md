---
title: 'DIST-003: Node-less install scripts (install.sh / install.ps1) for Bun binaries'
status: todo
created: 2026-07-11
priority: medium
urgency: later
area: scripts, .github/workflows
depends_on: ['DIST-002']
---

# Node-less install scripts for the Bun binaries

Let users install `robota` **without Node.js** via a one-line command that detects OS + CPU, downloads the correct
binary (from DIST-002 GitHub Releases), and installs it so `robota` runs from the shell.

Owner requirement (2026-07-11). Depends on DIST-002 (the released assets + stable names).

## What

1. **`scripts/install.sh`** (macOS/Linux) — detect OS (`darwin`/`linux`) + CPU (`arm64`/`x64`) via `uname`,
   construct the release asset name (`robota-<os>-<arch>`), download it, `chmod +x`, and place it on a PATH dir
   (e.g. `~/.robota/bin` with a PATH hint, or `/usr/local/bin` when writable), then verify `robota --version`.
2. **`scripts/install.ps1`** (Windows PowerShell) — detect arch, download `robota-windows-x64.exe`, install to a
   per-user dir (e.g. `%LOCALAPPDATA%\robota\bin`), add it to the user PATH, verify `robota --version`.
3. **Install URL as a single constant** in each script (the base download/host URL), clearly separated at the top
   so it can be changed later without touching logic. Scripts must work when served from GitHub Pages, GitHub
   Releases, or a separate static URL.
4. **One-line install UX** documented + wired:
   - macOS/Linux: `curl -fsSL https://<host>/install.sh | bash`
   - Windows PowerShell: `irm https://<host>/install.ps1 | iex`
     Decide + document how the scripts are hosted (e.g. published to GitHub Pages, or served from a pinned Release
     asset / raw URL). Version selection: default to the latest release, with an optional pinned-version env/arg.
5. **Robustness:** fail loudly on unsupported OS/arch, checksum-verify the download if DIST-002 publishes
   checksums, and never require Node.js at any step.

## Non-goals

- The binaries themselves (DIST-001) or the release workflow (DIST-002).
- A package-manager (brew/scoop) formula — could be a later follow-up.

## Test Plan

- `shellcheck` on `install.sh`; `PSScriptAnalyzer` on `install.ps1` (or the repo's chosen linters), both clean.
- Dry-run each script against a real DIST-002 release: fresh environment WITHOUT Node.js → run the one-liner →
  confirm `robota --version` works afterward on macOS, Linux, and Windows.
- OS/arch detection unit-checks (table of `uname`/arch → expected asset name).
- Confirm the install URL constant is the only place to change the host.

## User Execution Test Scenarios

**Scenario A — Node-less install on macOS/Linux.**

- Prerequisites: a machine (or container) with NO Node.js installed; a published DIST-002 release.
- Steps: `curl -fsSL https://<host>/install.sh | bash` → open a new shell → `robota --version` → `robota --help`
  → a basic command.
- Expected: install succeeds without Node; `robota` is on PATH and runs.
- Evidence: _(fill after implementation: terminal transcript incl. `which robota` and the three commands, and
  proof Node is absent — `command -v node` empty.)_

**Scenario B — Node-less install on Windows.**

- Steps: in PowerShell (no Node): `irm https://<host>/install.ps1 | iex` → new PowerShell session →
  `robota --version` / `--help` / basic command.
- Expected: installs to the user dir, adds to PATH, runs without Node.
- Evidence: _(fill after implementation.)_

**Scenario C — changing the install host is a one-line edit.**

- Steps: change the URL constant at the top of each script; re-run.
- Expected: downloads from the new host with no other edits.
- Evidence: _(fill after implementation.)_
