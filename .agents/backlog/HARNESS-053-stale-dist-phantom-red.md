---
id: HARNESS-053
title: 'HARNESS-053: a stale dist makes `pnpm typecheck` report a phantom breakage of a healthy branch'
status: todo
priority: medium
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-26
depends_on: [HARNESS-052]
---

## Problem

HARNESS-052 records the class "a check that reports success over work it did not do". This item
records the **inverse** of the same root cause, which has now cost a full investigation cycle: a
check that reports **failure over work that is fine**.

`pnpm typecheck` resolves a cross-package import (`@robota-sdk/agent-tools` from
`packages/agent-framework`) to the producing package's built `dist/*.d.ts`, not to its source. When
that `dist/` predates the source, `tsgo` compares NEW consumer source against an OLD producer type
surface. Every resulting error is a real TypeScript error about an unreal state of the repository.

**Reproduced 2026-07-26.** `origin/develop` @ `39cb7a074` was reported broken with three specific
failures. All three were artifacts of a partially stale `dist/` in one working tree:

| Reported failure                                                                                      | Actual cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isPathInside` "not exported from `agent-core/src/index.ts`"                                          | It **is** exported, transitively: `src/index.ts` → `export * from './utils'` → `utils/index.ts` → `export * from './path-containment'`. Present in `dist` since SEC-006.                                                                                                                                                                                                                                                                                                                |
| `assertSafeSessionId` / `isSafeSessionId` "missing from the `agent-session` barrel"                   | `packages/agent-session/src/index.ts:63` exports both. The **stale** `agent-session/dist` (built 07-25 23:44, before SEC-006 landed) did not contain them.                                                                                                                                                                                                                                                                                                                              |
| `TS2559` on `createGlobTool(options)` / `createGrepTool(options)` in `assembly/create-tools.ts:66-67` | Stale `agent-tools/dist` still declared the pre-SEC-007 `createGlobTool(options?: IBuiltinToolDescriptionOptions)`. That type is `{ description?: string }` — a **weak type** with zero properties in common with `ICreateDefaultToolsOptions` (`sandboxClient?`/`cwd?`/`retrievalAdapter?`/`computerDriver?`), which is exactly what TS2559 reports. Current source takes `IContainedBuiltinToolOptions` (`extends IBuiltinToolDescriptionOptions` + `cwd?`), and the call typechecks. |

The barrel exports were correct **in the SEC-006 commit itself** (`git show
0c0dcd247:packages/agent-core/src/utils/index.ts` and `:packages/agent-session/src/index.ts` both
contain them). No PR ever landed the described breakage, so there is no "how did this reach develop
green" to answer and no scope-calculator gap: the scope calculator was never the reason, because
there was never a defect for it to miss.

The danger is symmetric and the _other_ direction is the serious one. A stale `dist` can equally
**hide** a real cross-package type error, and that failure mode is silent.

## Why the existing guard does not catch it

`scripts/harness/scan-dist-freshness.mjs` is a **presence** gate wearing a temporal name — its own
header says so (HARNESS-052), and the falsification is recorded there: `touch
packages/agent-core/src/index.ts` leaves the source newer than its dist and the scan still exits 0.
So `pnpm harness:scan` is green on precisely the tree that makes `pnpm typecheck` red.

The one entrypoint that is immune is `pnpm harness:verify-like-ci`, whose `build` stage exists
for this exact reason and rebuilds rather than trusting the presence scan. On the tree investigated
here it reported `PASS — all 11 stage(s) passed`, while a bare `pnpm typecheck` against the stale
tree reported the three failures above.

## Proposed guard

Make dist staleness **detectable** rather than inferable, so a stale local tree cannot masquerade as
a branch breakage:

1. Give `scan-dist-freshness.mjs` an actual freshness comparison: for each buildable package, the
   newest `src/**` mtime must not exceed the newest `dist/**` mtime. Emit a **warning** (not a
   failure) — mtimes are not a correctness oracle and a false red here would be its own vacuous
   gate. The point is a legible message at the moment of confusion, not a new blocking check.
2. Have `pnpm typecheck` fail _fast and explanatorily_ when it is about to compare source against a
   dist older than that source, naming `pnpm build` / `pnpm harness:verify-like-ci` in the message.
3. Route the diagnostic instruction: "a cross-package type error that only appears in a
   whole-workspace typecheck" should first be re-checked after `pnpm build`, before it is treated as
   a branch defect.

Each must be proven RED before the fix per `check-regression-red-proof` — a guard for a staleness
bug that was never demonstrated to detect staleness is the HARNESS-052 defect recurring inside its
own remedy.

## Acceptance

- Falsification recorded: with a deliberately stale `dist`, the new check goes red/warns; with a
  fresh one it is silent.
- `scan-dist-freshness`'s name and behaviour agree, or the divergence note is updated to point here.
- No new blocking check that can fire on a correct tree.
