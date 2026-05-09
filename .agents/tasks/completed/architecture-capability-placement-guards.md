# Architecture Capability Placement Guards

## Status

Completed.

## Created

2026-05-09

## Completed

2026-05-09

## Source Backlog

`.agents/backlog/architecture-capability-placement-guards.md`

## Recommendation

Implement the first guard as a harness scan instead of adding more prose.

Reason:

- The architecture map already defines stable owner-first placement rules.
- Product-shell ownership drift can be detected mechanically for high-risk patterns.
- Command/provider dependency drift can be checked from package metadata.
- Composition-root imports can be allowed when they target exported owner package entries with an
  owner `docs/SPEC.md`.

## Completed Changes

- Added `scripts/harness/check-capability-placement.mjs`.
- Added `pnpm harness:scan:capability-placement`.
- Wired the check into `pnpm harness:scan` and harness consistency required scripts.
- Added tests for product-shell ownership drift, command-package forbidden dependencies,
  composition-root imports, unexported subpaths, and undocumented workspace packages.

## Test Strategy

This is a harness governance change. Verification covers the new guard directly, then confirms root
harness scan integration.

## Verification

- `pnpm exec vitest run scripts/harness/__tests__/check-capability-placement.test.mjs`
- `pnpm harness:scan:capability-placement`
