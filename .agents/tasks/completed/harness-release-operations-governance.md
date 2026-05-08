# Harness Release Operations Governance

## Status

Completed.

## Created

2026-05-08

## Completed

2026-05-09

## Priority

P0 - release and publish reliability.

## Recommendation

Add a small executable release-run artifact instead of more prose. The release rules already existed;
the missing piece was a machine-checkable state file that blocks OTP-sensitive publish work when the
release state is unclear.

## Result

- Added `.agents/release-runs/` and `.agents/templates/release-run-template.md`.
- Added `scripts/harness/release-run.mjs` with:
  - `pnpm harness:release:init -- --version <version>`;
  - `pnpm harness:release:check -- --version <version> [--publish]`;
  - `pnpm harness:release:triage -- --version <version> --pr <number> --check <name>`;
  - `pnpm harness:release:report -- --version <version>`.
- Added parser/checker tests for green, pending, missing-field, and triage cases.
- Updated `check-release-governance.mjs` so `pnpm harness:scan:release-governance` verifies the
  release-run commands, template, README, and publish preflight wiring.
- Wired `pnpm publish:beta` to run `pnpm harness:release:check -- --version "$VERSION" --publish`
  before npm auth, dry-run, or OTP prompt.
- Updated release and publish rules to make the release-run artifact the executable release control
  plane.

## Verification

- `pnpm exec vitest run scripts/harness/__tests__/release-run.test.mjs scripts/harness/__tests__/harness-scripts.test.mjs`
- `pnpm harness:scan:release-governance`
- `pnpm harness:release:check`
- `pnpm harness:scan`
