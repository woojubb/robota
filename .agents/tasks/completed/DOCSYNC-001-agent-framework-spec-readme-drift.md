---
title: 'DOCSYNC-001: Reconcile agent-framework SPEC↔README public-API drift (createAgentRuntime)'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: low
urgency: later
area: packages/agent-framework
depends_on: []
---

## Evidence Log (2026-06-27)

- `agent-framework/README.md`: added `createAgentRuntime()` to the intro summary and a new
  "Headless / multi-session runtime" Quick-Start subsection with a minimal example
  (`createAgentRuntime({ cwd, provider }).createSession({})`), matching the SPEC's "primary
  public API" claim. README references: 0 → present.
- Confirmed the API against source: `createAgentRuntime(config: IAgentRuntimeConfig): IAgentRuntime`
  with `createSession()` composing `InteractiveSession`s.
- Verified: docs structure validation passes.

# Reconcile agent-framework SPEC ↔ README public-API drift

## What

`packages/agent-framework/docs/SPEC.md` lists `createAgentRuntime()` as a primary public-API
surface entry (5 references, incl. the "Public API Surface" table and a runtime-composition
section), but `packages/agent-framework/README.md` does **not mention it at all** (0
references; README documents only `InteractiveSession` and `createQuery()`). Verified
2026-06-27 (README: 0 hits, SPEC: 5 hits).

Per the three-doc-layer sync rule (SPEC + README + content stay aligned), reconcile:

- If `createAgentRuntime()` is genuinely a primary public entry point (SPEC says so), document
  it in the README's API/Quick-Start with a minimal headless/multi-session example.
- Confirm `content/` likewise reflects whichever surface is canonical, so all three layers
  agree.

## Why

A symbol that is "primary public API" in the SPEC but absent from the README leaves consumers
unaware of the headless/multi-session entry point and is exactly the SPEC↔README divergence
the sync rule exists to prevent.

## Done When

- The README documents `createAgentRuntime()` (or the SPEC is corrected if it is not actually
  primary — decide which layer is right, then align the others; do not silently downgrade the
  SPEC to match the README).
- A grep for `createAgentRuntime` across SPEC + README + content shows consistent treatment.

## Test Plan

- Grep all three layers for `createAgentRuntime` → consistent presence/role.
- Build the README example (if added) against real exports.

## User Execution Test Scenarios

1. A consumer reading only the README learns how to compose a headless runtime via
   `createAgentRuntime()` (or it's confirmed not public and absent everywhere). Evidence:
   _to fill._
