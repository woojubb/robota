---
title: 'TRANS-009: the transport toggle reports enabled after a file write and discards the write failure'
issue: https://github.com/woojubb/robota/issues/2050
status: done
created: 2026-08-25
completed: 2026-08-25
priority: high
urgency: soon
area: packages/agent-transport, packages/agent-transport-tui
depends_on: []
---

# TRANS-009: the transport toggle reports enabled after a file write and discards the write failure

## Problem

Toggling a transport in the settings TUI tells the user the transport is enabled. Nothing has been
started. If the write that produced that claim failed, the user is told nothing at all.

Two halves of one user-visible lie, produced by the same two lines of TUI code.

## Evidence

Measured at `e5551e9b6`.

<!-- evidence-superseded: STRUCT-012 S2 moved this historical source to packages/agent-framework/src/transport-host/transport-registry.ts; the original evidence describes the earlier revision. -->

**The success half.** `packages/agent-transport/src/transport-registry.ts:124-127`:

```ts
async setEnabled(name: string, enabled: boolean): Promise<void> {
  this.requireConfigurable(name);
  this.settings.setEnabled(name, enabled);
}
```

`this.settings.setEnabled` is `TransportSettingsView.setEnabled`, which calls `mutate` →
`readSettings` / `writeSettings`. **It writes a file and returns.** `grep -nE 'start|stop'` over
`transport-settings-view.ts` returns one hit, in a doc comment describing the _other_ half of the
registry. Nothing on this path starts or stops a runtime transport.

The method is `async` and returns `Promise<void>` while doing nothing asynchronous, which is what
makes the caller's `await` look like it is waiting for an operation.

**The silence half.** `packages/agent-transport-tui/src/TransportTUI.tsx:71-79`:

```tsx
registry
  .setEnabled(entry.transport.name, !entry.config.enabled)
  .then(() => {
    refresh();
    setSaving(false);
  })
  .catch(() => setSaving(false));
```

The `catch` takes the error and discards it whole. A `requireConfigurable` rejection and a
`writeSettings` failure both land here and both produce the same visible result as success minus the
refresh: the spinner stops.

## Why the two are one item

They are the same two lines, they are verified by the same fixture, and fixing either alone leaves a
user misinformed — one about what is running, the other about whether their action took effect. A
reconciled toggle that still swallows its failure reports a lie less often; a surfaced failure on a
toggle that never starts anything reports the same lie with better error handling.

## Direction

Two decisions, and the record should not pre-empt either — both are named in issue #2050:

1. **If toggles are immediate**, persistence and start/stop become one typed operation whose result
   the caller can render. `setEnabled` stops being an `async` method that awaits nothing.
2. **If they apply next session**, the surface says so explicitly, and the TUI renders "enabled on
   next start" rather than "enabled".

Either way the failure path must be renderable: the `catch` receives a typed error and the TUI shows
it. `transport-registry-errors.ts` already exists and already builds typed errors with a stable
`name` and `code`, so the shape is available.

## Test Plan

- A toggle against a real registry proves the documented runtime behaviour — if immediate, the
  adapter is started; if deferred, it is not, and the surface says so. **The assertion is on the
  adapter's state, not on the settings file**, because the settings file is what the current code
  already gets right.
- A failing write surfaces in the TUI. Drive it with a settings path that cannot be written and
  assert on what the component renders, not on whether `writeSettings` threw.
- Positive control for both: the success path still renders success, so a test that proves a failure
  is reported cannot pass against a component that reports failure unconditionally.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

### Scenario 1 — a toggle claims a transport is running that is not

1. Run `robota` and open the transport settings surface.
2. Select a transport that is currently disabled and press space to enable it.
3. Observe the row now reports the transport as enabled.
4. Without restarting, check whether that transport is actually accepting connections on its port.

**Expected after the fix:** either the transport is genuinely started and accepting connections, or
the row states that the change applies from the next start. **Today:** the row reports enabled and
nothing is listening.

### Scenario 2 — a failed write reports nothing

1. Make the settings file unwritable (`chmod 400` on the resolved settings path).
2. Run `robota`, open transport settings, and toggle any transport.
3. Observe what the surface reports.

**Expected after the fix:** the surface reports that the change could not be saved, naming the
reason. **Today:** the spinner stops and nothing else changes; re-opening the surface shows the old
value with no explanation.
