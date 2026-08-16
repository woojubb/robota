---
title: 'CORE-045: `Robota.registerTool()` throws on every freshly constructed agent, because the tool registry it writes to is only initialized by the first run — so the public API for adding a tool after construction cannot be called before one, and nothing in the repository calls it'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-045: the post-construction tool API is unreachable

Found while writing the CORE-042 parity suite (2026-08-16), which needed it and could not use it.

## Problem

`Robota.registerTool(tool)` (`packages/agent-core/src/core/robota.ts:323`) delegates to
`RobotaConfigManager.registerTool`, whose first statement is
`tools.hasTool(tool.schema.name)` (`robota-config-manager.ts:278`). `Tools` extends `AbstractManager`,
and `hasTool` opens with `ensureInitialized()` (`managers/tool-manager.ts:148-149`), which throws
while `initialized` is false.

`new Tools()` happens in the `Robota` constructor (`robota.ts:106`), but `initialize()` is awaited
only inside `ensureFullyInitialized()`, which the entry points call — `run()`, `runStream()` and the
other public methods. So the ordering is:

```ts
const robota = new Robota(config);
robota.registerTool(new EchoTool()); // throws: "Tools is not initialized"
```

and the only way to reach a working `registerTool` is to run a turn first, which is precisely the
situation the method exists to avoid.

**Measured 2026-08-16** in `packages/agent-core/src/core/__tests__/entry-point-parity.test.ts`: the
suite was first written with `robota.registerTool(...)` and every such case failed with
`Error: Tools is not initialized`. The suite now registers tools through `config.tools`, which is why
this is filed rather than worked around silently — the workaround is in the tests, and the defect is
in the product.

## Why it survived

**Nothing calls it.** A repository-wide search for `.registerTool(` finds the declaration, the
config-manager delegate, and no caller at all — no test, no example, no app. `unregisterTool` is in
the same position. A public method with zero callers has no way to be found broken, which is the same
mechanism that let the streaming turn diverge for six capabilities before CORE-042.

Note the asymmetry that hides it: `config.tools` works, because the constructor path registers those
during initialization. So the feature appears to work for everyone who declares tools up front, and
fails only for the dynamic case.

## Direction

Two shapes, and the choice is a real one rather than a detail:

- **Make the registry usable before the first run.** `Tools` has an async `initialize()` because
  `AbstractManager` defines one, but `doInitialize` may well have nothing asynchronous to do — if so,
  the registry can be constructed ready and `ensureInitialized` stops being reachable for it.
- **Or make `registerTool` await initialization**, which changes its signature to
  `Promise<void>` and makes the public API honest about the fact that an agent is not fully
  constructed until it has initialized.

The first is preferable, and **it is already settled by reading**: `Tools.doInitialize`
(`managers/tool-manager.ts:34-36`) does nothing but emit a debug log. There is no asynchronous work to
wait for, so the `initialized` flag guards nothing and a registry that must be initialized before it
can answer `hasTool` is a lifecycle nobody asked for. This is recorded so the item does not re-derive
it; the remaining work is the change, its red-first test, and the sweep below.

Whichever is taken, `unregisterTool` and any other `ensureInitialized`-guarded public surface reached
directly off the constructor must be checked in the same pass — this is a class of defect, and fixing
the one method that happened to be needed is the fix-it-where-it-surfaced failure mode.

## Test Plan

- Red first: `new Robota(config).registerTool(tool)` on a freshly constructed agent, with no prior
  run, succeeds — it throws today.
- The registered tool is then offered to the model on the next turn, asserted through
  `IChatOptions.tools` (the parity suite's tool-list case is the template).
- `unregisterTool` on a fresh agent, same shape.
- An enumeration test over `Robota`'s public methods that reach an `ensureInitialized`-guarded
  manager, so a future method cannot join this class unnoticed.

## User Execution Test Scenarios

**Applies** — `registerTool` is a public export of `@robota-sdk/agent-core` and this is exactly what a
user calling it experiences. Author the scenario when the item is picked up: a scripted-provider agent
constructed with no tools, given one via `registerTool`, and asked a question the tool answers. No API
key or network needed.
