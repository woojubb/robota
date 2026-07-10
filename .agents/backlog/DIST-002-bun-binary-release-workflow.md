---
title: 'DIST-002: GitHub Actions workflow to build + publish Bun binaries to Releases'
status: todo
created: 2026-07-11
priority: medium
urgency: later
area: .github/workflows, packages/agent-cli
depends_on: ['DIST-001']
---

# GitHub Actions workflow: build + publish Bun binaries to GitHub Releases

Add a CI workflow that builds the five Bun single-file executables (from DIST-001) for every target platform and
uploads them as assets to a GitHub Release. Must NOT interfere with the existing release/publish flow (npm publish
stays manual `workflow_dispatch`, per the current `release.yml`).

Owner requirement (2026-07-11). Depends on DIST-001 (the compile config + binary names must exist first).

## What

1. **Build matrix** producing the five named binaries: `robota-darwin-arm64`, `robota-darwin-x64`,
   `robota-linux-x64`, `robota-linux-arm64`, `robota-windows-x64.exe`. Prefer Bun's cross-compilation
   (`--target=bun-<os>-<arch>`) so most/all targets can build from a single runner where feasible; otherwise use a
   platform matrix (macos/ubuntu/windows runners). Document which approach is chosen and why.
2. **Trigger.** Fire on a release tag (e.g. `v*`) and/or `workflow_dispatch`. Do NOT auto-run on every push. Keep
   it independent of the existing `release.yml` (manual npm publish) — adding this must not change npm publishing.
3. **Upload to GitHub Releases.** Attach all five binaries (+ optionally SHA-256 checksums) as release assets on
   the matching release. Stable, predictable asset names (exactly the DIST-001 names) so the DIST-003 install
   scripts can construct download URLs deterministically.
4. **Provide the workflow as a concrete file** (`.github/workflows/bun-release.yml` or similar), reviewed against
   the repo's existing workflow conventions (pinned action versions, least-privilege `permissions:` incl.
   `contents: write` for release upload).

## Non-goals

- The Bun compile config itself (DIST-001).
- The install scripts / hosting (DIST-003).
- Changing npm publish or the `release.yml` manual flow.

## Test Plan

- `actionlint` (or the repo's workflow linter) clean on the new workflow.
- Dry-run / `workflow_dispatch` on a test tag in a fork or a draft release; confirm all five assets appear with the
  exact expected names + non-zero size, and checksums (if added) match.
- Confirm the existing CI (`ci.yml`) and `release.yml` are unchanged and still green.

## User Execution Test Scenarios

**Scenario A — release produces all five binaries.**

- Prerequisites: DIST-001 merged; a test tag / draft release.
- Steps: trigger the workflow (tag push or `workflow_dispatch`) → open the resulting GitHub Release.
- Expected: the release lists exactly `robota-darwin-arm64`, `robota-darwin-x64`, `robota-linux-x64`,
  `robota-linux-arm64`, `robota-windows-x64.exe` (+ checksums if included), each downloadable and non-empty.
- Evidence: _(fill after implementation: release URL + asset list screenshot/text; download one asset and run
  `--version`.)_

**Scenario B — a downloaded binary runs on its platform.**

- Steps: download the asset matching the tester's OS/arch from the Release and run `--version` / `--help`.
- Expected: runs with no Node.js installed; prints version/usage.
- Evidence: _(fill after implementation.)_
