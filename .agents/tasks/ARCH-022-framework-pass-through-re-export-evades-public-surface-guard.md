---
title: 'ARCH-022: agent-framework tunnels four agent-core runtime helpers through a non-facade barrel — the pass-through ban holds only at src/index.ts, so laundering one hop deeper passes the guard'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-framework, scripts/harness/check-sdk-public-surface.mjs
depends_on: []
---

# ARCH-022: pass-through re-export + guard blind spot

## Problem

`agent-framework`'s public surface re-exports four agent-core runtime values through
`src/commands/index.ts`, violating the package's own no-pass-through rule (INFRA-025) — and the
mechanical guard cannot see it, because it checks owner-package sources only in the top-level entry.
The violation and the blind spot are one item: removing the re-export without widening the guard
leaves the laundering channel open.

## Evidence

- `packages/agent-framework/src/commands/index.ts:127-132` — `export { formatEnvReference,
hasUsableSecretReference, isEnvReference, resolveEnvReference } from '@robota-sdk/agent-core';`
  re-surfaced at `src/index.ts:130-136`. SSOT: `agent-core/src/index.ts:155-157`.
- `packages/agent-framework/docs/SPEC.md:67` — "No pass-through re-exports (INFRA-025): the public
  index exposes framework-OWNED symbols only"; `docs/PUBLIC-SURFACE.md:19-26` — runtime re-exports
  allowed only in the named facade barrels, and "must not directly re-export from
  `@robota-sdk/agent-core`". `SPEC.md:979` misattributes the helpers' ownership to
  `command-api/provider/`.
- Guard blind spot: `scripts/harness/check-sdk-public-surface.mjs:81-90` checks owner-package
  re-exports only in `SDK_TOP_LEVEL_ENTRY` (`src/index.ts`, line 14) — verified by running the scan:
  it reports clean today.

## Direction

1. Delete the re-export; consumers import the helpers from `@robota-sdk/agent-core` (changeset —
   this narrows a published surface).
2. Extend `check-sdk-public-surface.mjs` to flag owner-package re-exports in ANY barrel reachable
   from the public entry (walk the re-export graph from `src/index.ts`), with a red-first fixture.
3. Fix `SPEC.md:979` ownership prose.

## Test Plan

- Red-first: guard fixture with a nested pass-through must FAIL before the guard fix.
- `rg` shows zero `from '@robota-sdk/agent-core'` value re-exports in framework barrels post-change.
- Build + typecheck green workspace-wide (call sites migrated); changeset present.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — internal surface hygiene + guard hardening; the public-API narrowing is covered by
the changeset/migration note, and no runnable product behavior changes.
