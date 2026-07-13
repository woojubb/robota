# RELEASE-001 — automate the binary release off a version bump (npm stays OTP-manual)

Spec: `.agents/spec-docs/active/RELEASE-001-automated-release-pipeline.md` (status: in-progress).
Owner approved 2026-07-14 (rule-conformance delegated; owner chose binaries-only scope — npm stays OTP-manual per
`release-operations.md`). proposal-review REVISE (npm-auto conflicted with the OTP policy) → re-scoped to binaries.

When an `agent-cli` version bump lands on main, push `v<version>` (deploy key) → fires the DIST-002/GUI-003
`v*` workflows → binaries + installers auto-attach to the Release. npm/OTP/governance untouched.

## Tasks

- [x] T1: `.github/workflows/release-tag-on-version-bump.yml` — detect agent-cli bump vs HEAD^, guard existing tag,
      push `v<version>` via `RELEASE_DEPLOY_KEY`. actionlint clean; bump-logic dry-run TC-01/02/03; other release
      files byte-unchanged.
- [x] T2: `.github/RELEASING-BINARIES.md` runbook + deploy-key setup.
- [ ] T3: feature→develop→main via merge-verifier.
- [ ] T4 (GATE-COMPLETE): User Execution Test — owner provisions `RELEASE_DEPLOY_KEY`, lands a version bump, and
      confirms the tag auto-fires the binary release.

## Test Plan

- **Agent-owned (local/static):** `actionlint` clean; dry-run of the bump-detection + existing-tag-guard logic
  (changed → push, unchanged → skip, tag-exists → skip); `git diff origin/main` confirms `release.yml` /
  `release-bun-binaries.yml` / `release-desktop-app.yml` / `release-operations.md` / `check-release-governance.mjs`
  are byte-unchanged (no npm/OTP conflict). The `v*`→binaries half is already proven (test-tag: 11 assets +
  `install.sh` install).
- **User Execution Test (T4, needs the deploy key):** a real version-bump commit on main → `v<version>` auto-pushed
  → binary/desktop workflows run → Release lists 5 binaries + `SHA256SUMS.txt` + 5 installers.
