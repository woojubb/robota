---
title: 'ARCH-022: agent-framework launders owner-package runtime values through reachable public barrels — the guard checks only one root file instead of the package export graph'
status: done
created: 2026-08-13
completed: 2026-08-16
priority: medium
urgency: soon
area: packages/agent-framework, scripts/harness/check-sdk-public-surface.mjs
depends_on: []
---

# ARCH-022: pass-through re-export + guard blind spot

## Problem

`agent-framework`'s public surface launders owner-package runtime values through reachable local
barrels, violating the package's own no-pass-through rule (INFRA-025). The known env helpers travel
through both `command-api/index.ts` and `commands/index.ts`; the interactive barrel also forwards
agent-session's session-id guards. The mechanical guard cannot see these paths because it checks
owner-package sources only in the top-level entry. Removing one finite export list without traversing
the real public graph leaves the laundering channel open.

## Evidence

- `packages/agent-framework/src/commands/index.ts:127-132` — `export { formatEnvReference,
hasUsableSecretReference, isEnvReference, resolveEnvReference } from '@robota-sdk/agent-core';`
  re-surfaced at `src/index.ts:130-136`. SSOT: `agent-core/src/index.ts:155-157`.
- `packages/agent-framework/src/command-api/index.ts:87-92` repeats the same owner-package re-export on a
  reachable barrel path.
- `packages/agent-framework/src/interactive/index.ts:12` forwards `assertSafeSessionId` and
  `isSafeSessionId` directly from `agent-session`; `apps/agent-server` consumes the latter from the
  framework instead of its owner.
- `packages/agent-framework/docs/SPEC.md:67` — "No pass-through re-exports (INFRA-025): the public
  index exposes framework-OWNED symbols only"; `docs/PUBLIC-SURFACE.md:19-26` — runtime re-exports
  allowed only in the named facade barrels, and "must not directly re-export from
  `@robota-sdk/agent-core`". `SPEC.md:979` misattributes the helpers' ownership to
  `command-api/provider/`.
- Guard blind spot: `scripts/harness/check-sdk-public-surface.mjs:81-90` checks owner-package
  re-exports only in `SDK_TOP_LEVEL_ENTRY` (`src/index.ts`, line 14) — verified by running the scan:
  it reports clean today.

## Direction

1. Remove every owner-package pass-through reachable from the framework's public source entry roots.
   Consumers import env helpers from `@robota-sdk/agent-core` and session-id guards from
   `@robota-sdk/agent-session`; the published narrowing receives a beta-line breaking changeset.
2. Derive public source entry roots from `packages/agent-framework/package.json` exports (currently `.`
   and `./testing`). Recursively follow local re-export edges with cycle protection, explicit `.js`→`.ts`,
   extensionless-file, and directory-`index.ts` resolution. An unresolved local re-export is a finding,
   never a silently ignored edge. Only reachable files are judged; unreachable internal barrels remain
   internal.
3. At every reachable file, reject type or value re-exports from forbidden owner packages while retaining
   the named `agent-executor` runtime-facade exception. Fix the framework SPEC ownership prose and public
   surface table.

## Recommendation Gate

- 2026-08-16 — `DEPTH: LOCAL`; the defect is the incomplete package-export graph guard and the reachable
  owner-package laundering it permits.
- 2026-08-16 — independent final review endorsed the package-declared-root, recursive, cycle-safe,
  fail-closed graph scan and the complete owner-import migration.

REVIEW VERDICT: ENDORSE

## Test Plan

- Red-first: direct, depth-2, and depth-3 owner laundering fail; a cycle terminates safely; unreachable
  barrels and allowed runtime facades remain clean; type-only pass-through and unresolved local edges
  fail; both package export roots are traversed.
- The graph scan reports zero value or type pass-through from every forbidden owner package across every
  package-declared public source root; an independent `rg` inventory agrees with the reachable findings.
- Build + typecheck green workspace-wide (including the agent-server owner import); changeset present.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

**Not applicable.** This work delivers no runnable user-facing capability or changed runtime behavior:
it removes an ownership-violating convenience import and hardens the repository's public-export graph
guard. The env helpers and session-id guards retain the same runtime behavior at their owner-package
imports, so inventing a command or SDK run would exercise unchanged owner behavior rather than this
change.

Engineering evidence substitute: the red-first reachable-graph fixtures cover direct/deep/cyclic/type-only
laundering and unresolved edges; framework and agent-server typecheck/build prove the owner-import
migration; the zero-pass-through scan and beta changeset prove the narrowed published surface. These stay
in `## Test Plan` and are not represented as user-execution evidence.

## Scenario Plan Gate

- 2026-08-16 — author classified the item as `not-applicable`: it changes compile-time export ownership
  and a repository guard, not a runnable product surface; the concrete engineering substitute is recorded
  above.

SCENARIO DRAFTED: not-applicable | 0

- 2026-08-16 — independent PLAN guardian reviewed the recorded exception and returned PASS: the work
  changes only compile-time export ownership and repository enforcement, while the unchanged owner-package
  runtime behavior is correctly retained as engineering evidence rather than a fabricated product scenario.

DONE-GATE-STAGE-1: PASS

## Completion Evidence

- 2026-08-16 — applicability was re-checked against the completed diff: it changes compile-time export
  ownership, consumer import paths, and the repository public-surface guard, with no changed runtime
  command or SDK result. The recorded `Not applicable` classification therefore still holds.
- Durable engineering evidence is owned by
  `scripts/harness/__tests__/check-sdk-public-surface.test.mjs` and
  `scripts/harness/check-sdk-public-surface.mjs`. The graph fixtures, framework/server checks, and final
  repository scan passed; the public-surface narrowing is recorded by
  `.changeset/arch-022-owner-direct-public-surface.md`.

### [COMPLETION-APPLICABILITY] — ✅ PASS / NOT-APPLICABLE | 2026-08-16

- Independent guardian re-checked the completed diff and upheld the recorded N/A classification: no
  runnable product behavior changed, so a Stage-2 product scenario would be fabricated.
- The owner Vitest graph suite passed `14/14`; the live public-surface scan passed; the durable guard,
  fixture, and changeset paths above all exist.
- **Guardian verdict:** `COMPLETION APPLICABILITY VERDICT: PASS — NOT-APPLICABLE VALID`.
