---
title: 'WS-001: Handle promise rejections in agent-transport-ws message handler (no silent loss)'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: high
urgency: soon
area: packages/agent-transport-ws
depends_on: []
---

## Evidence Log (2026-06-27)

- `ws-handler.ts`: `session.submit(...)` now `.catch((error: Error) => send protocol_error)`;
  `session.executeCommand(...)` uses the two-arg `.then(onOk, onErr)` form sending a
  `protocol_error` on rejection — mirroring `ws-background-messages.ts`.
- Tests: added "submit rejection → protocol_error" and "command rejection → protocol_error"
  (WS-001); fixed the mock `submit` to return a promise. `agent-transport-ws` 33 tests pass,
  typecheck clean.

# Handle promise rejections in the WS message handler

## What

`packages/agent-transport-ws/src/ws-handler.ts` fires async session calls without handling
rejection, so a failure is silently lost and never reaches the client (violates the
no-fallback rule — errors must surface):

1. **`ws-handler.ts:229`** — `session.submit(msg.prompt);` is a floating promise: not awaited,
   no `.catch`. If `submit` rejects (network/session failure), the rejection is unhandled and
   the client gets no `protocol_error`. The codebase's own patterns handle this:
   `query.ts:86` uses `session.submit(prompt).catch(...)` and
   `examples/websocket-chat/src/server.ts:99` does the same.
2. **`ws-handler.ts:235-243`** — `session.executeCommand(...).then((result) => send(...))` has
   no rejection handler; if `executeCommand` rejects (or `send` throws), the error is
   unhandled. The sibling file `ws-background-messages.ts:99-102` already uses the correct
   two-arg `.then(onOk, onErr)` form that sends a `protocol_error`.

Make both paths surface failures to the client (a `protocol_error` message), matching the
existing two-arg-`.then` / `.catch` patterns already used in the same package.

## Why

A WebSocket consumer that submits a prompt or runs a command gets no feedback when the
operation fails — the request appears to hang. This is a real latent bug and a direct
no-fallback violation, and the package already has the correct pattern a few lines away.

## Done When

- `submit` and `command` handlers send a `protocol_error` (or equivalent) on rejection, like
  the background-message handler.
- A test simulates a rejecting `submit`/`executeCommand` and asserts the client receives an
  error message (no unhandled rejection).
- `pnpm --filter @robota-sdk/agent-transport-ws test` + build pass.

## Test Plan

- Unit test: stub a session whose `submit`/`executeCommand` rejects → handler emits
  `protocol_error`; no unhandled-rejection warning.
- Grep the handler for bare `.then(` / floating session calls → all have rejection handling.

## User Execution Test Scenarios

1. Over a WS connection, submit a prompt that triggers a backend failure → the client receives
   an error frame instead of silence. Evidence: _to fill._
