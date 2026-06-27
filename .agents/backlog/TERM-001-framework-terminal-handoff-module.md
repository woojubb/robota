---
title: 'TERM-001: terminal-handoff capability (transport contract + framework orchestration)'
status: todo
created: 2026-06-27
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework
depends_on: []
---

# Terminal-handoff capability

The capability to temporarily hand the real terminal to a child process and restore the agent's
presentation afterward.

## Layer placement (verified against the dependency rules)

Terminal handoff is fundamentally a **transport capability** — only the transport owns the real
display/TTY. Architecture review (against the actual workspace deps) corrected two earlier mistakes:

- **The contract lives in `agent-interface-transport`, not `agent-framework`.** That package is the
  SSOT for transport-facing contracts (it already defines `IInteractionChannel`), and the
  `interface-imports` scan mechanically fails any transport that imports such a contract from
  `agent-framework`. So a new `ITerminalHandoff` capability (`canHandoffTerminal` + `runWithTerminal`)
  is added there, as an optional sibling capability a channel may also implement.
- **`agent-framework` owns the ORCHESTRATION + host surface, not the contract.** `InteractiveSession`
  receives the channel's handoff capability (constructor-callback injection, like the existing
  "Preset execution capability") and surfaces `runWithTerminal` to commands on the framework-owned
  `ICommandHostContext`, enforcing exclusivity, the permission gate, and a fast-fail when
  `canHandoffTerminal === false`. The framework still must NOT depend on `ink`.

```
agent-interface-transport   ITerminalHandoff CONTRACT (types only)
        ▲ import (gate-allowed)            ▲ import
agent-transport-tui / -transport(headless) IMPLEMENT   agent-framework ORCHESTRATE + ICommandHostContext surface
```

## Boundary / platform neutrality (non-negotiable)

`agent-framework` is **pure Node/JS and platform-neutral**. This module must carry **no POSIX
assumption** — no `sh`, no shell, no knowledge of _what_ child is run. It owns only the terminal
**handoff lifecycle** (suspend the display → run a caller-supplied function with the real TTY →
restore). _Which_ process/shell is spawned is the **consumer module's** concern (e.g. `BashTool`
uses `sh`; `/shell` resolves `$SHELL`) — those are separate, replaceable modules, and that is where
the POSIX-first / Windows-later seam lives (TERM-003, TERM-005, TERM-007). The framework handoff is
therefore **cross-platform by construction**; it is not scoped to macOS/Linux.

## What

Add the contract (in `agent-interface-transport`) and the framework orchestration:

```ts
// agent-interface-transport — TYPES ONLY (no impl), alongside IInteractionChannel.
interface ITerminalHandoff {
  /**
   * Suspend the display, run `fn` (the CALLER spawns whatever child it wants with inherited stdio),
   * then restore the display. The contract never spawns a shell itself — platform-neutral.
   */
  runWithTerminal<T>(fn: () => Promise<T>): Promise<T>;
  /** Whether an interactive terminal handoff is actually possible in this transport. */
  readonly canHandoffTerminal: boolean;
}
```

- `agent-framework` owns the **orchestration + host surface only**: it receives the channel's
  capability, surfaces `runWithTerminal` on `ICommandHostContext`, guarantees the display is
  suspended around `fn` and restored on success and on throw, enforces exclusivity (one handoff at a
  time), gates on permissions, and fast-fails when `canHandoffTerminal === false` (headless / piped).
  It may provide a tiny **pure-Node** helper to spawn a caller-provided `command`/`args` with
  `stdio: 'inherit'` (no shell hardcoded) — but the command/shell choice belongs to the caller.
- `agent-framework` must NOT depend on `ink`; the contract import is from `agent-interface-transport`.
- The **transport implements** `runWithTerminal`: the TUI suspends/resumes its rendering (TERM-002);
  a headless/non-interactive transport runs `fn` directly (no display to suspend) or reports
  `canHandoffTerminal === false`.

## Two invocation modes (both must be supported)

1. **Synchronous foreground handoff** — a caller invokes `runWithTerminal(fn)` directly and blocks
   while the user interacts with the child (input + output via the real TTY). Consumers are
   **framework-level commands** that can access `ICommandHostContext`: `/shell` (TERM-003), `$EDITOR`
   (TERM-004), and the interactive-command path (TERM-005). NOTE: the zero-dep `agent-tools` `BashTool`
   is NOT a direct consumer — see TERM-005.
2. **Asynchronous background + notify** — already built: the background-task system (`agent-executor`)
   runs a child without blocking, and on completion / output-match / schedule emits
   `background_task_waking(+instruction)` → `requestWakeup` → an `agent-wakeup` turn triggers
   follow-up (FLOW-002/003/004). TERM-006 adds the bridge so a background child that needs the user
   can request a foreground handoff through this same wake channel.

## Design decisions

1. **Seam — DECIDED: transport-capability contract (interface-transport) surfaced as an optional
   host capability (framework).** The `ITerminalHandoff` contract is defined in
   `agent-interface-transport` (gate-correct for transports to implement). The active transport
   implements it on/with its interaction channel; `InteractiveSession` receives it via
   constructor-callback injection (the existing "Preset execution capability" pattern) and surfaces
   `runWithTerminal` on `ICommandHostContext` (alongside `applyPersona?` / `getAgentJobCapability?` /
   `spawnMonitorWake()`). Rationale: the async-notify path already flows through host capabilities +
   wake, so co-locating the handoff surface there unifies both invocation modes; placing the contract
   in interface-transport keeps the transport off an `agent-framework` import (interface-imports gate).
2. **Concurrency / safety**: handoff is exclusive (refuse while a turn is streaming or another
   handoff is active) and abort-safe.
3. **Headless behavior**: when `canHandoffTerminal` is false, fail fast with a clear message (do not
   hang); a headless transport with a real inherited TTY may still run `fn` directly.
4. **Input**: baseline `stdio: 'inherit'` (real TTY → bidirectional input/output, pure Node, cross
   platform). `node-pty`/ConPTY is **deferred** to a follow-up only if detach-reattach or pty
   buffering is ever required (TERM-007 may evaluate for Windows).

## Why

Today `BashTool` runs every command with fully piped stdio, so any child needing a real TTY (editors,
pagers, `fzf`, interactive git, password prompts, `gh auth login`) breaks. There is no way to hand the
terminal over. Putting this in the framework (not the TUI), as a platform-neutral lifecycle, keeps the
TUI thin AND keeps POSIX/shell specifics out of the framework — every consumer (BashTool — TERM-005,
`/shell` — TERM-003, `$EDITOR` — TERM-004) and every transport reuse one capability.

## Test Plan

- Framework unit tests with a fake `runWithTerminal` (no real TTY): verify orchestration runs `fn`,
  restores on success and on throw, rejects concurrent handoff, and errors when `canHandoffTerminal`
  is false.
- A framework functional test (via `@robota-sdk/agent-framework/testing`) exercising the capability
  through a real `InteractiveSession` with a scripted transport handoff.
- Add a `functional-coverage` manifest row.
- typecheck / lint / `pnpm harness:scan` green; no new agent-framework → ink dependency (deps scan).

## User Execution Test Scenarios

Validated through its consumers (TERM-003/004/005), which carry the user-facing scenarios. This item
is the internal capability; its evidence is the Test Plan + functional-coverage entry.
