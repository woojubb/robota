---
status: in-progress
type: BEHAVIOR
tags: [transport, tui, correctness]
---

# TRANS-009: the transport toggle reports enabled after a file write and discards the write failure

## Problem

Toggling a transport in the settings TUI tells the user it is enabled. Nothing has been started. If
the write that produced that claim failed, the user is told nothing at all.

Measured at `1874a187e`:

```ts
// transport-registry.ts:124-127
async setEnabled(name: string, enabled: boolean): Promise<void> {
  this.requireConfigurable(name);
  this.settings.setEnabled(name, enabled);   // → readSettings / writeSettings. That is all.
}
```

`grep -nE 'start|stop'` over `transport-settings-view.ts` returns one hit, inside a doc comment about
the _other_ half of the registry. Nothing on this path starts or stops a runtime transport. The method
is `async` and returns `Promise<void>` while doing nothing asynchronous, which is what makes the
caller's `await` look like it is waiting for an operation.

```tsx
// TransportTUI.tsx:71-79
registry
  .setEnabled(entry.transport.name, !entry.config.enabled)
  .then(() => {
    refresh();
    setSaving(false);
  })
  .catch(() => setSaving(false)); // the failure, taken and discarded
```

`TransportTUI.tsx:26-28` renders the badge from `entry.config.enabled` — the persisted value. So the
row reads `[enabled]` because a file changed, not because a transport is running.

**One path reports a success it did not achieve; the other reports nothing about a failure it did
have. Both come from the same two lines.**

## Prior Art Research

Waived: the subject is the internal contract between this repository's transport registry, its
settings persistence and its own TUI. The decidable question — whether this product's toggle is
immediate or deferred — is a fact about this codebase's lifecycle model (`startAll` reads
`getEnabled()` at start; there is no per-transport start), read directly below. No external product's
documentation determines what `TransportRegistry` already does.

## Solution (draft direction)

**Recommendation: make the surface tell the truth about the deferred behaviour, rather than making the
behaviour immediate.**

Deferred is what the code already does and it is coherent: `startAll` reads `getEnabled()` when a
session starts, so a toggle takes effect at the next start. Making it immediate would require a
per-transport start/stop that the lifecycle does not have — `ITransportLifecycleRegistryView` offers
`startAll` and `stopAll` over the whole set, and the registry carries a single `state` machine. That
is new lifecycle surface, and lifecycle semantics are ARCH-011's territory rather than this fix's.

So:

1. **The TUI renders what actually happened** — the change is saved and applies from the next start,
   not "enabled" as a running state. Issue #2050 names this option explicitly: _"If they apply next
   session, name and render that explicitly."_
2. **The failure surfaces.** The `catch` receives a typed error and the component renders it.
   `transport-registry-errors.ts` already builds errors with a stable `name` and `code`, so the shape
   exists; nothing new is needed on the contract to stop discarding it.
3. **The SPEC states which it is.** `agent-transport/docs/SPEC.md:187` lists `setEnabled` among the
   registry's methods and says nothing about when it takes effect — which is why two readings were
   available.

**Deliberately NOT in scope:** changing `setEnabled` from `Promise<void>`, or making it synchronous.
It is misleading, and it is a contract change across `ITransportSettingsRegistryView`,
`ITransportRegistryView` and both SPECs for no correctness gain once the surface is honest. Worth its
own item if anyone wants it.

## Completion Criteria (draft)

- A toggle against a real registry leaves the adapter **not started**, and the surface says the change
  applies from the next start. The assertion is on the adapter's state, not on the settings file — the
  file is what the current code already gets right.
- A failing write surfaces in the TUI. Driven with a settings path that cannot be written, asserting
  on what the component renders rather than on whether `writeSettings` threw.
- **Positive control**: the success path still renders success, so a test proving a failure is
  reported cannot pass against a component that reports failure unconditionally.
- **Coverage control**: at least one case exercises the state the change actually alters — the render
  path — rather than only the persistence path that was already correct. (HARNESS-122's lesson: a
  mutation test proves a case measures the guard, not that the cases cover its reach.)
- `agent-transport/docs/SPEC.md` states when a toggle takes effect.
- `pnpm harness:scan` green.

## Test Plan

- A toggle leaves the adapter **not started** and the surface says the change applies at the next
  start. The assertion is on what the component RENDERS, not on whether `setEnabled` was called — a
  test asserting the call passes against the old code and the new one, because the call was never the
  defect.
- A failing write renders its reason. Driven with a rejecting registry, asserting on the frame.
- A non-`Error` rejection still produces a sentence rather than `undefined`.
- **Positive control**: the success path renders no failure, so the two failure cases cannot pass
  against a component that reports failure unconditionally.
- **Both badge branches are asserted.** The enabled branch alone left the disabled one uncovered by a
  change that rewrote both — measured: reverting the badge killed one case before the second was
  added and two after.
- `agent-transport/docs/SPEC.md` states when a settings change takes effect.
- `pnpm harness:scan` green; both affected package suites green.

## User Execution Test Scenarios

### Scenario 1 — a toggle no longer claims a transport is running

1. Run `robota` and open the transport settings surface.
2. Select a disabled transport and press space.
3. Read the row and the footer.

**Expected:** the row shows the saved setting (`[on]`), and the footer states that the change applies
the next time Robota starts. **Before this change:** the row read `[enabled]`, which a user reasonably
took to mean the transport was up — nothing had been started, and nothing said so.

### Scenario 2 — a failed save is reported

1. Make the settings file unwritable (`chmod 400` on the resolved settings path).
2. Run `robota`, open transport settings, and press space on any transport.

**Expected:** the surface reports `Not saved — …` with the reason. **Before this change:** the
spinner stopped and nothing else changed; re-opening the surface showed the old value with no
explanation.

## Evidence Log

- 2026-08-25 — Measured at `1874a187e`. `setEnabled` → `TransportSettingsView.setEnabled` → `mutate` →
  `readSettings`/`writeSettings`; no start/stop on the path. TUI badge renders `entry.config.enabled`.
- 2026-08-25 — Lifecycle surface checked before recommending deferred: `ITransportLifecycleRegistryView`
  exposes `startAll`/`stopAll` only, and `TransportRegistry` carries one `state`. There is no
  per-transport start to call, so "immediate" is a new capability rather than a wiring fix.
- 2026-08-25 — `agent-transport/docs/SPEC.md:187` names `setEnabled` without saying when it takes
  effect. Both readings were available from the document, which is part of the defect.
- 2026-08-25 — **GATE-APPROVAL: owner sign-off obtained**, including the design decision. Asked
  immediate-versus-deferred; the owner selected **"지연임을 사실대로 표시"** — render the deferred
  behaviour truthfully rather than making the toggle immediate. A peer session's instruction to start
  this item set the ORDER of work and was explicitly not treated as this approval.
- 2026-08-25 — Implemented. `TransportTUI` badge names the saved setting (`[on]`/`[off]`) instead of
  `[enabled]`/`[disabled]`; a footer states the change applies at the next start; the `catch` renders
  the reason instead of discarding it. `agent-transport/docs/SPEC.md` now states that `setEnabled`
  and `setOptions` persist only, and why that had to be written down.
- 2026-08-25 — Six cases added, and verified by mutation against each of the three changes: reverting
  the badge kills 2, restoring the discarding `catch` kills 2, removing the footer kills 1. The
  success case is the positive control — without it the failure cases would pass against a component
  that reports failure unconditionally.
- 2026-08-25 — **Coverage checked, not just mutation-killed.** The first badge case asserted only the
  enabled branch, so reverting the badge killed one test while the change had rewritten both branches.
  A disabled-branch case was added and the same mutant then kills two. This is HARNESS-122's lesson
  applied rather than restated: a mutation proves a case measures the change, not that the cases reach
  across it.
- 2026-08-25 — `agent-transport-tui` 700 tests pass, `agent-transport` 82 pass, `tsgo --noEmit` clean,
  `pnpm harness:scan` 143 passed / 0 failures.
