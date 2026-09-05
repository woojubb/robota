---
title: 'ARCH-018: the IInteractionChannel charter ("all interactive transports implement it") is false for three of its four named cases — and the flagship implementer no-ops the contract''s central member'
status: done
completed: 2026-08-16
created: 2026-08-13
priority: medium
urgency: soon
area: .agents/project-structure.md, packages/agent-interface-transport, packages/agent-transport, packages/agent-transport-tui
depends_on: []
---

# ARCH-018: which seam is the transport contract, really?

## Problem

The Interaction Channel Contract section presents `IInteractionChannel` as "the interface that all
interactive transports implement (TUI, headless, future web/remote)". In reality: headless
deliberately does not implement it (the same section admits this two sentences later), the arrived
web/remote transports chose a different seam entirely (`IConfigurableTransport` over
`IInteractiveSession`), and the TUI — the named flagship implementer — implements the type while
no-opping `write()`, the contract's primary data path. The charter describes a world that never
materialized, and the stated headless rationale (the 8-member `InteractionEvent` union loses session
events) applies equally to every full-featured transport, making the charter unsatisfiable as
written.

## Evidence

- `.agents/project-structure.md:281` — the universal charter; `:286` — its own exception
  ("`HeadlessInteractionChannel` does not").

<!-- evidence-superseded: STRUCT-012 S2 moved this historical source to packages/agent-framework/src/transport-host/headless/HeadlessInteractionChannel.ts; the original evidence describes the earlier revision. -->

- `packages/agent-transport/src/headless/HeadlessInteractionChannel.ts:93` — plain class, no
  implements; the real implementers repo-wide are exactly `TuiInteractionChannel` and
  `ProgrammaticInteractionChannel`.
- `packages/agent-transport-ws/src/ws-transport-configurable.ts:57-58` (and -webrtc) — the "future
  web/remote" transports implement `IConfigurableTransport`/`IPayloadChannelHost` over
  `IInteractiveSession`, never `IInteractionChannel`.
- `packages/agent-transport-tui/src/TuiInteractionChannel.ts:139-144` — `write(_event): void {}` —
  "Intentionally unused in TUI direct-wiring mode … The two paths are mutually exclusive." The TUI
  gets its data by constructing the session itself, subscribing to raw session events, and exposing
  `getSession()` to hooks (`useTuiChannel.ts:107`); the contract says "Framework pushes one-way
  display events. Fire-and-forget." (`interaction-contracts.ts:32-33`).

## Direction

Decide and document the seam's real charter (one design fact, three symptoms):

- **(a) Narrow the charter (doc-first).** State in project-structure.md and the interface SPEC that
  `IInteractionChannel` is the seam for `createInteractiveRuntime`-wired channels (today: the
  programmatic driver; the TUI implements the type for interface-compat but wires directly), while
  ws/http/mcp/webrtc/headless sit on `IInteractiveSession`. Then either remove the TUI's nominal
  `implements` or annotate the no-op `write()` as compat-only in both docs.
- **(b) Make the charter true (code).** Grow `InteractionEvent` to carry the session-event surface
  transports actually need and migrate transports onto the channel — this is a large refactor that
  overlaps ARCH-012's capability-port direction and should only be chosen deliberately alongside it.

Recommendation: (a) now; note (b) as the ARCH-012-adjacent long-term question.

## Recommendation Gate

- 2026-08-15 — `DEPTH: LOCAL`; the universal charter and nominal TUI conformance are the defect.
- 2026-08-15 — independent review endorsed narrowing the charter to the
  `createInteractiveRuntime`/programmatic family and removing the TUI's no-op nominal implementation.

REVIEW VERDICT: ENDORSE

## Scenario Plan Gate

- 2026-08-15 — `NOT-APPLICABLE` accepted because the selected change is documentation plus nominal
  TypeScript conformance removal with no runtime observable.

DONE-GATE-STAGE-1: PASS

## Test Plan

- (a): revised project-structure section and interface SPEC agree with the code (both implementer
  lists mechanically greppable); if the TUI drops the nominal implements, typecheck green across
  agent-transport-tui/agent-cli.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

**Not applicable.** The recommended option (a) changes the architecture charter and, if needed, removes
only the TUI's nominal TypeScript `implements` declaration; it does not change any runtime command,
public SDK result, rendered UI state, or workflow behavior that a user can execute. Documentation,
typecheck, and conformance evidence belong in `## Test Plan`; inventing a product run would not exercise
this work. Option (b), if separately approved later, is a runtime transport migration and must define its
own user-execution scenario before implementation.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** planned-not-applicable → verified-not-applicable

- **Applicability re-check:** the completed change narrows the architecture charter and removes only
  `TuiInteractionChannel`'s nominal `IInteractionChannel` conformance and unused no-op `write()` path;
  its session ownership, subscriptions, rendering, and runtime workflow remain unchanged.
- **Contract evidence:** the project structure and interface/framework/TUI SPECs consistently name
  `ProgrammaticInteractionChannel` as the `createInteractiveRuntime` port implementation, while the
  charter test mechanically rejects the former universal-transport claim and nominal TUI conformance.
- **Engineering verification:** the exact TUI scoped harness verification passed build, all `73` test
  files / `568` tests, typecheck, and its dependent CLI typecheck. The repository `harness:scan`
  completed with `110` scans passed and `2` intentionally skipped.
- **Scenario outcome:** `NOT-APPLICABLE` is upheld; no product scenario was invented for a change with
  no runtime observable.
