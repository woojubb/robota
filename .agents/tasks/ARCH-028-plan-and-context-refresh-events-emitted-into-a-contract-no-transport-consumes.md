---
title: 'ARCH-028: plan_event and context_file_refreshed are emitted by the framework into an event contract whose charter says transports consume it, but every transport in every cluster ignores them — two shipped features (SELFHOST-002 plan lifecycle, context-file staleness) are invisible on every surface'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework, packages/agent-transport-tui, packages/agent-transport-protocol, packages/agent-transport
depends_on: []
---

# ARCH-028: emitted session events no transport consumes

## Problem

The mirror of ARCH-020 (which is about a declared event with no emitter): here two events ARE emitted
by the framework, but no transport subscribes to them, even though the event contract's charter says
"consumed by transports". So SELFHOST-002 plan-mode lifecycle transitions and context-file refresh
notifications fire and reach no surface — TUI, WS bridge, or headless.

## Evidence (round-2 cross-cluster critic, 2026-08-13)

- `packages/agent-interface-transport/src/event-contracts.ts:4-8` — "SSOT for the event/record payload
  shapes … consumed by transports through IInteractiveSessionEvents";
  `session-contracts.ts:316-317` — `plan_event` "Emitted on every plan-mode lifecycle transition …
  SELFHOST-002"; `:310-311` — `context_file_refreshed` "Emitted when a context file (AGENTS.md or
  CLAUDE.md) is refreshed".
- Emit sites exist: `agent-framework/src/interactive/interactive-session.ts:878,900,910` (`plan_event`);
  `interactive-session-context-refresh.ts:40` (`context_file_refreshed`).
- Zero production subscribers: the TUI binding list (`TuiInteractionChannel.ts:475-510`) omits both;
  the WS bridge fan-out (`ws-session-events.ts:97-113`) omits both; the headless runner subscribes only
  `goal_event` (`headless-runner.ts:87`). `plan_event`'s only subscribers are its own tests;
  `context_file_refreshed` has zero subscribers anywhere.
- This also undermines ARCH-020's stated fix: ARCH-020 directs implementers to "mirror how
  plan_event/goal_event are emitted so a GUI/monitor surface can render branch changes" — but the WS
  bridge forwards neither plan_event nor branch_event, so the mirror reaches no surface either.

## Direction

Decide per member (same shape as ARCH-020): wire a consumer — a TUI notice and/or WS-bridge forwarding
so a GUI/monitor can render plan-mode transitions and context-file refreshes — or strike the "consumed
by transports" charter clause for these members and mark them forward-provisioned. Coordinate with
ARCH-020 (branch_event) and ARCH-016 (session-log vocabulary) so the plan/branch/context event family
is resolved consistently across emit, transport-forward, and log-record.

## Test Plan

- Red-first: subscribe a transport (TUI channel binding or WS bridge fan-out) to `plan_event` and
  `context_file_refreshed`, drive a plan-mode transition and a context-file refresh, assert the surface
  receives them. Fails today.
- `pnpm harness:verify -- --scope packages/agent-transport-tui` (and the WS bridge scope) green.

## User Execution Test Scenarios

**Applies** (plan mode and context-file refresh are user-facing behaviors).

- Prerequisites: built CLI + provider key; a project with an AGENTS.md/CLAUDE.md; a plan-mode-capable
  session.
- Steps: enter/exit plan mode, and edit the project's context file mid-session to trigger a refresh;
  observe whether the TUI (or GUI monitor) reflects either transition.
- Expected (after fix): plan-mode transitions and the context-file refresh are visible on the surface.
- Expected (before fix, contrast): neither is shown despite the events firing internally.
- Cleanup: none.
- Evidence (fill in after implementation): the surface reflecting a plan transition and a context
  refresh.
