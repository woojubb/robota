---
title: 'WEBUI-002: agent-web-ui runtime robustness — render error state, guard JSON.parse, null-safety'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-web-ui
depends_on: []
---

## Evidence Log (2026-06-27)

- `SessionMonitor.tsx`: render conversation only when `connected`; `error` now shows a
  reasoned message ("Connection error — could not reach <url>…") instead of a blank view.
- `ws-session-client.ts`: `JSON.parse` wrapped in try/catch; a malformed frame is surfaced as
  a synthetic `protocol_error` via `onMessage` (no throw / no UI freeze).
- `useWsSession.ts`: `user_message` content now uses `?? ''` (parity with the `messages` case).
- Tests: new `ws-session-client.test.ts` (mocked WebSocket) — malformed frame → protocol_error
  (no throw), well-formed frame passes through. 2 tests pass; typecheck + build clean.

# agent-web-ui runtime robustness

Distinct from WEBUI-001 (tests / a11y / public surface / build-output) — these are runtime
defects in the WS client/UI, found 2026-06-27.

## What

1. **Error status is configured but never rendered (`SessionMonitor.tsx`, error config at
   line 28).** An `error` status entry exists, but when `status === 'error'` the component
   falls through to render an (empty) `ConversationView` instead of an error message. On a
   failed WS connection the user sees a blank screen with no explanation. Render the error
   state (message + the failing URL/reason).
2. **Uncaught `JSON.parse` in the WS `onmessage` handler
   (`client/ws-session-client.ts:64`).** `const msg = JSON.parse(data) as TServerMessage;`
   has no try/catch — a single malformed frame (corruption, version skew) throws in the
   handler and breaks the client with no surfaced error. Wrap in try/catch and surface a
   protocol/parse error via the existing callback path.
3. **Inconsistent null-safety on message content (`hooks/useWsSession.ts:69`).** The
   `'messages'` case guards `content ?? ''` (line ~62), but the `'user_message'` case uses
   `content: msg.content` with no fallback, so a protocol deviation yields
   `content: undefined`. Apply the same `?? ''` guard for consistency.

## Why

Items 1-2 are user-visible failure modes (blank screen / frozen UI with no feedback) that
violate the no-fallback principle (errors must surface). Item 3 is a small consistency fix in
the same hot path. None are covered by WEBUI-001's tests/a11y/surface scope.

## Done When

- A failed/`error` session status renders a visible error message (with reason), not a blank
  view.
- `JSON.parse` is guarded; a malformed frame produces a surfaced parse/protocol error instead
  of an uncaught throw.
- `user_message` content uses the same `?? ''` fallback as the `messages` case.
- Tests cover the error-render, malformed-frame, and missing-content paths; build + test pass.

## Test Plan

- Unit: feed a malformed WS frame → handler surfaces an error, no throw.
- Unit/render: set status `error` → error UI appears; send `user_message` with no content →
  renders empty string, not `undefined`.

## User Execution Test Scenarios

1. Point the UI at an unreachable WS URL → a clear connection-error message appears (not a
   blank screen); a malformed server frame shows an error instead of freezing. Evidence:
   _to fill._
