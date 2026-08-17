---
title: 'HARNESS-108: barrel-parameter-types reads 2 of 55 package barrels, and 16 findings sit outside its scope'
status: todo
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

Two were read against the source rather than trusted from scan output:

- `agent-tools` exports `createGlobTool` but not its parameter type `IContainedBuiltinToolOptions` —
  while exporting `IGrepToolOptions` and `IShellToolOptions` right beside it. The inconsistency is
  the defect.
- `agent-cli` exports `startCli` but not `IStartCliOptions`, though `cli.ts` re-exports the type.

## Blocked on first — the name-collision false positive

The floor decides "this type belongs to another package" by looking the name up across the whole
package `src`, not by resolving the parameter type through the declaring file's imports. Round-3
review constructed the failure: a barrel taking a foreign `IForeign` fires as soon as any unrelated
file in the same package declares a local `IForeign`. At two barrels this is theoretical; across 55
it is a name collision away from reddening CI on correct code, with no allowlist.

So the resolution order is: fix the resolution, then widen. Widening first buys a floor that has to
be switched off.

## Done when

- Parameter types resolve through the declaring file's own imports, so a same-named local type in an
  unrelated file cannot make a foreign type look local (and its mirror — a barrel-local declaration
  cannot silence a finding about a different type of the same name from a submodule).
- Every package barrel is in `barrelParameterTypes.barrels`, or a barrel left out names why.
- The 16 findings are resolved — each verified against the source first, since a scan finding is a
  claim, not a proof.
- The `Contained — HARNESS-108.` paragraph in the config comment is removed, because it no longer
  describes anything.

## Not in scope

Return types and other packages' types stay excluded — see the scan header. Requiring a barrel to
re-export a foreign type would demand exactly the pass-through re-exports STRUCT-07 bans, i.e. the
rule would contradict a rule.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                          | Notes                                                          |
| ----- | ----------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| TC-01 | Unit test   | Foreign parameter type + an unrelated same-named local declaration       | Must stay silent — the false positive that blocks the widening |
| TC-02 | Unit test   | Barrel-local `IThing` + a different `IThing` from a submodule            | Must still fire — the mirror of TC-01                          |
| TC-03 | Unit test   | Widen the configured list to all 55 and assert the finding count is zero | Red proof that the burn-down actually finished                 |
| TC-04 | CI pipeline | `pnpm harness:scan`, `pnpm typecheck`, `pnpm test`                       | Whole-repository gate                                          |
