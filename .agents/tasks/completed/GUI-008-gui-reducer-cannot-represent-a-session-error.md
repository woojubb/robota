---
title: 'GUI-008: the GUI session reducer has no error/protocol_error case — after a session error the partial text stays "streaming", the next turn concatenates onto it, tools stay running, and the user never sees the error'
status: skipped
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-transport-gui, packages/agent-transport-webrtc-web, apps/agent-app, apps/agent-web
depends_on: []
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2164#issuecomment-5460833502
---

# GUI-008: session errors are silently dropped by every GUI surface

## Problem

The wire protocol delivers `error` and `protocol_error` server messages, but the GUI's session
reducer handles neither and `IWsSessionState` has no error field. On the error path the session emits
`error` then `thinking:false` but never `complete`, and only `complete`/`interrupted`/`history_cleared`
flush the streaming buffer — so an errored turn leaves stale partial text rendering as "streaming",
the next turn's deltas concatenate onto it, in-flight tools stay `running` forever, and the user is
never shown the error in any GUI surface.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-transport-gui/src/hooks/useSessionClient.ts:112-216` — the reducer switch has cases
  for messages/user_message/text_delta/thinking/tool_start/tool_end/execution_workspace_event/prompts/
  ui_intent/session_renamed/history_cleared/complete/interrupted and NO case (and no default) for
  `error` or `protocol_error`; `IWsSessionState` (`:62-85`) has no error field. Both are real wire
  types (`agent-transport-protocol/src/ws-protocol.ts:71,115`) the server actually sends
  (`ws-session-events.ts:64-65,104` forwards session `error`; `ws-handler` sends `protocol_error`).
- Server error path: `agent-framework/src/interactive/interactive-session-prompt.ts:119-160` catch
  routes to `onError` not `onComplete`; the controller emits `error`
  (`interactive-session-execution-controller.ts:289-292`) and `thinking:false` in `finally`, never
  `complete`.
- Only `complete`/`interrupted` (`useSessionClient.ts:199-214`) and `history_cleared` (`:192-197`)
  flush `streamingTextRef`/`activeTools`; after an error the partial text keeps rendering as a
  streaming block (`ConversationView.tsx:224`), the next turn's `text_delta` concatenates onto the
  stale ref (`:134-143`), and `activeTools` entries stay `running`.
- No component defeats this: `SessionMonitor.tsx:114-115` and `RemoteClient.tsx:66` handle only the
  CONNECTION status, not a session error; `apps/agent-app/src/App.tsx` and
  `apps/agent-web/src/app/remote/page.tsx` add nothing. `ws-session-client.ts:70-73` even synthesizes
  a `protocol_error` for malformed server JSON, which the reducer then silently drops.

## Direction

Add `error` and `protocol_error` arms to the reducer: flush/clear the streaming buffer, mark in-flight
tools failed, and surface the message via a new error slot on `IWsSessionState`. Render it in
`SessionSurface`/`SessionMonitor`/`RemoteClient`. The TUI already renders session errors
(`agent-transport-tui/src/TuiInteractionChannel.ts:453-456`), so this brings the GUI to parity.

## Test Plan

- Red-first: a reducer unit test feeding `text_delta` → `error` → `text_delta` asserts the first
  turn's partial text is flushed, tools are marked failed, the error is exposed on state, and the
  second turn's text does not concatenate onto the first. Fails today.
- `pnpm harness:verify -- --scope packages/agent-transport-gui` green.

## User Execution Test Scenarios

**Applies** (the GUI is a product surface).

- Prerequisites: built desktop app driving the sidecar (or `apps/agent-web /remote`); a way to force a
  provider error (invalid key or a scripted-provider error fixture — authored by this work).
- Steps: start a turn that errors mid-stream, then start a normal turn.
- Expected (after fix): the error is shown, the streaming block clears, tools show failed, and the
  next turn renders cleanly.
- Expected (before fix, contrast): no error appears, the partial text stays "streaming", the next
  turn's text is glued onto it, and a tool spinner never stops.
- Cleanup: none.
- Evidence (fill in after implementation): before/after screenshots of the GUI on an errored turn.

## Resolution

This local finding is a concrete repeated instance of the broader per-surface protocol-variant
contract tracked by ARCH-059 / issue #2164. The reducer gap remains an implementation concern, so
this record is archived as skipped and returned to that canonical issue rather than claiming the
GUI behavior is fixed locally.
