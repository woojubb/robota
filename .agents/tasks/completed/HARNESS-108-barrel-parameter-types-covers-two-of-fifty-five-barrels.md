---
title: 'HARNESS-108: barrel-parameter-types reads 2 of 55 package barrels, and 16 findings sit outside its scope'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2457#issuecomment-5457499038
created: 2026-08-18
priority: medium
urgency: soon
area: scripts/harness, packages
depends_on: []
issue: https://github.com/woojubb/robota/issues/1851
---

# HARNESS-108: the barrel parameter-type floor covers 4% of the tree

Filed out of ARCH-037, whose review found the floor it added is scoped to two barrels. The GitHub
issue (#1851) is the registered form; this file is the queue entry, because `.agents/tasks/` is what
a session reads and what `resolveRootItems` resolves a `Contained — <ID>.` label against.

## The gap

`barrelParameterTypes.barrels` in `.agents/harness.config.json` lists:

```
packages/agent-executor/src/index.ts
packages/agent-framework/src/index.ts
```

The workspace has **55** package barrels. A floor scoped to 4% of the tree prints what a fully-scoped
one prints on a clean tree, so the scope is the check.

## Measured

Running the floor over the other 53 barrels returns **16 findings across 10 barrels**. Round-3 review
re-ran the measurement independently and inspected all 16: **none is a false positive**.

| Barrel                                             | Findings |
| -------------------------------------------------- | -------- |
| `packages/agent-transport-webrtc-web/src/index.ts` | 4        |
| `packages/agent-core/src/index.ts`                 | 2        |
| `packages/agent-playground/src/index.ts`           | 2        |
| `packages/dag-framework/src/index.ts`              | 2        |
| `packages/agent-cli/src/index.ts`                  | 1        |
| `packages/agent-command/src/index.ts`              | 1        |
| `packages/agent-remote-client/src/index.ts`        | 1        |
| `packages/agent-tools/src/index.ts`                | 1        |
| `packages/agent-transport-gui/src/index.ts`        | 1        |
| `packages/agent-transport-webrtc/src/index.ts`     | 1        |

Round-3 review re-ran the measurement independently and inspected all 16; none is a false positive.
(Issue #1851 was filed before that pass and still reads "the other 14 are unverified scan output" —
this file is the later reading, and #1851's Done-when quotes an earlier wording of the config
comment. Reconcile the issue when this item is picked up.)

Two of the sixteen were read line-by-line against the source when this item was filed; round-3
review then re-ran the sweep independently and inspected all sixteen, finding no false positive. So
the strongest true statement is "sixteen reproduced twice by independent runs, all sixteen
inspected, two read in full detail" — an earlier draft of this file said both "all 16 inspected" and
"two rather than trusted from scan output" eight lines apart, which are not the same claim. The two
read in full:

- `agent-tools` exports `createGlobTool` but not its parameter type `IContainedBuiltinToolOptions` —
  while exporting `IGrepToolOptions` and `IShellToolOptions` right beside it. The inconsistency is
  the defect.
- `agent-cli` exports `startCli` but not `IStartCliOptions`, though `cli.ts` re-exports the type.

## Blocked on first — the remaining half of the name-collision problem

ARCH-037 already closed the OUTWARD half: a parameter type now resolves through the declaring file's
own imports, so a foreign type stays foreign however many unrelated local declarations share its
name — including through a namespace import (`other.IThing`). Both directions have tests.

What is still open is the INWARD half, and it is the one that blocks the widening. `exportedNames`
is a flat set of names, so a barrel that publishes its own `IThing` silences a finding about a
DIFFERENT `IThing` reaching a signature from a submodule: the floor reports clean on a function no
consumer can call correctly. Closing it needs declaration identity (`file#name`) rather than a name
set — the same lesson ARCH-029 landed one package over: resolve through the declaring file, never
through a global name map.

So the order is: close the identity half, then widen. Widening onto a floor that any common type
name can silence buys a floor that gets switched off.

## Done when

- A barrel-local declaration can no longer silence a finding about a DIFFERENT type of the same name
  reaching the signature from a submodule — i.e. `exportedNames` carries declaration identity rather
  than bare names. (The outward direction shipped with ARCH-037 and has tests; this is its mirror.)
- Every package barrel is in `barrelParameterTypes.barrels`, or a barrel left out names why.
- The 16 findings are resolved — each verified against the source first, since a scan finding is a
  claim, not a proof.
- The `Contained — HARNESS-108.` comment in `scripts/harness/scan-barrel-parameter-types.mjs` is
  removed, because it no longer describes anything.

## Not in scope

Return types and other packages' types stay excluded — see the scan header. Requiring a barrel to
re-export a foreign type would demand exactly the pass-through re-exports STRUCT-07 bans, i.e. the
rule would contradict a rule.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                    | Notes                                                                               |
| ----- | ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| TC-01 | Unit test   | Barrel-local `IThing` + a DIFFERENT `IThing` reaching a signature from a submodule | Must fire — today it is silenced, and this is the residual that blocks the widening |
| TC-02 | Unit test   | The outward cases ARCH-037 shipped stay green                                      | Regression pin: closing the identity half must not reopen the over-fire             |
| TC-03 | Unit test   | Widen the configured list to all 55 and assert the finding count is zero           | Red proof that the burn-down actually finished                                      |
| TC-04 | CI pipeline | `pnpm harness:scan`, `pnpm typecheck`, `pnpm test`                                 | Whole-repository gate                                                               |
