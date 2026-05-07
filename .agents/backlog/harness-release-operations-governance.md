# Harness Release Operations Governance

## Status

Backlog.

## Created

2026-05-08

## Priority

P0 - release and publish reliability.

## Problem

Release and publish work can still drift into ad-hoc CI debugging when the agent does not keep a
single explicit release state. The failure mode is costly:

- release PRs, CI fixes, version bumps, and npm publish can become interleaved without a stable
  control plane;
- pending CI checks can be watched without inspecting the current job step or stop condition;
- CI failures can be patched before the failure class, owner, local reproduction status, and
  validation gate are recorded;
- OTP-sensitive publish work can start after too much time has passed, making the user wait without
  a clear state transition.

## Current Signals

- `.agents/rules/release-operations.md` now defines a release control plane, release state machine,
  CI failure triage, long-running gate rules, dist artifact invariant, publish boundary, and stop
  conditions.
- `scripts/harness/check-release-governance.mjs` now mechanically checks that the release rules,
  root harness wiring, CI dist artifact invariant, release-grade script shape, and publish boundary
  remain present.
- `pnpm harness:scan` now includes `pnpm harness:scan:release-governance`.
- `.agents/rules/common-mistakes.md` now records ad-hoc release debugging, unclassified CI fixes,
  and unmanaged release watchers as known failure modes.

## Scope

- Extend release governance from static rule coverage into an executable release-run state file or
  command.
- Add a lightweight release-state template that records current SHA, branch, PR, target version,
  active gate, next action, and stop condition.
- Add a CI triage template that records failure class, log signature, local reproduction status,
  owning layer, minimal fix, and validation gate before code changes.
- Add harness checks that detect release-state drift for release branches or publish branches.
- Add a process for clearing abandoned watchers and long-running local commands after interruption.
- Add release/publish transcript summaries so final reports include merged PRs, validation gates,
  published version, and skipped checks.

## Recommended Direction

Keep the current `release-operations.md` and `check-release-governance.mjs` as phase 1. Add phase 2
as a small executable release-run artifact rather than more prose.

Recommended shape:

- `.agents/release-runs/<version>.md` or `.agents/release-runs/<date>-<version>.md` owns the live
  release state.
- `pnpm harness:release:init -- --version <version>` creates the state file from a template.
- `pnpm harness:release:check` validates required fields and blocks publish if the state file says
  a gate is pending or failed.
- `pnpm harness:release:triage -- --pr <number> --check <name>` appends a structured triage note
  before any CI-fix branch is created.
- `pnpm publish:beta` or its preflight should check the release-run state before requesting OTP.

This keeps the agent workflow explicit and auditable without turning release work into a heavy
release management system.

## Non-Goals

- Do not make npm publish automatic from CI.
- Do not store OTPs, API keys, npm tokens, or other secrets in release-run files.
- Do not make every feature PR create a release-run file.
- Do not replace GitHub Actions as the release-grade gate.
- Do not reintroduce per-package CI builds.

## Acceptance Criteria

- [ ] Release-run files or an equivalent structured artifact exist for release/publish operations.
- [ ] The artifact records current SHA, branch, PR, target version, active gate, next action, and
      stop condition.
- [ ] CI-fix work during release requires a structured triage note before code changes.
- [ ] Harness can validate that a release-run is green before `pnpm publish:beta` asks for OTP.
- [ ] Long-running watcher cleanup is documented and mechanically checked where feasible.
- [ ] Final release reports can be generated or verified from the release-run artifact.
- [ ] Tests cover the release-run parser/checker and failure cases for missing state fields.

## Verification Plan

- `pnpm harness:scan:release-governance`
- `pnpm exec vitest run scripts/harness/__tests__/harness-scripts.test.mjs`
- Unit tests for any new release-run parser/checker.
- A dry-run release-run fixture that covers pending, failed, and green states.

## Promotion Path

1. Move to `.agents/tasks/INFRA-BL-0XX-harness-release-run-state.md`.
2. Implement the release-run template and parser first.
3. Wire the parser into `harness:scan:release-governance`.
4. Add publish preflight integration only after parser tests are stable.
