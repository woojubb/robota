---
title: 'TRANS-004: the WS command/command_result wire pair is fully server-implemented but no GUI/remote client can send it or render its result — CMD-004 built command execution into the wire and REMOTE-006 declares remote drivers "full drivers", yet no remote surface can run a command, and the wire submit path has no slash parsing'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2164#issuecomment-5459592489
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-transport-protocol, packages/agent-transport-gui, packages/agent-transport-webrtc-web, packages/agent-cli
depends_on: []
---

# TRANS-004: remote surfaces can't execute commands

## Problem

The transport-neutral wire protocol declares and fully implements a `command`/`command_result` pair
(server side executes `session.executeCommand(..., 'remote', driverId)` and replies), and serve-mode
defers host teardown specifically so the in-flight `command_result` reaches "the requesting surface".
But no GUI or remote client anywhere sends `{type:'command'}` or renders `command_result` — so the
requesting surface does not exist. And the wire `submit` path has no slash parsing, so a GUI user
typing `/help` sends it to the model as prose.

## Evidence (round-2 cross-cluster critic, 2026-08-13)

- `packages/agent-transport-protocol/src/ws-protocol.ts:32` — declares `{ type: 'command'; name;
args? }`; `ws-handler.ts:225-240` fully implements it (`session.executeCommand(..., 'remote',
driverId)` → `command_result`). `agent-cli/src/modes/serve-mode.ts:181-184` defers teardown 500ms
  "so the in-flight `command_result` reaches the requesting surface" under the REMOTE-006 charter
  "a remote driver is a full driver".
- Repo-wide: ZERO clients send `{type:'command'}` and ZERO consume `command_result`. The GUI reducer
  handles 18 kinds, not `command_result` (`agent-transport-gui/src/hooks/useSessionClient.ts:113-216`);
  every client send site is `submit`/`get-messages`/`ack`/`resume`/prompt-answer
  (`SessionMonitor.tsx:125`, `SessionSurface.tsx:186`,
  `agent-transport-webrtc-web/src/client/rtc-session-client.ts:125-203`); agent-remote-client,
  agent-cli-web, and apps/agent-app have no references.
- No slash parsing on the wire submit path: `ws-handler.ts:219-224` routes straight to
  `session.submit`, so a GUI user's `/help` is sent to the model as text.

## Direction

Give the GUI surfaces a command path — slash detection in the Composer producing `{type:'command'}`
plus a `command_result` reducer case that renders the result — so the implemented server side and the
REMOTE-006 "full driver" charter are true. Alternatively de-scope wire commands and strike the
serve-mode teardown comment and the REMOTE-006 wording. The current state (implemented + teardown
protection for a non-existent client) is the wrong one.

## Test Plan

- Red-first: a GUI/remote client sends `/help` (or any command) over the WS and renders the
  `command_result`; a slash-prefixed input is routed as a command, not submitted to the model. Fails
  today.
- `pnpm harness:verify -- --scope packages/agent-transport-gui` and `--scope
packages/agent-transport-protocol` green.

## User Execution Test Scenarios

**Applies** (the GUI/remote monitor is a product surface).

- Prerequisites: built desktop app (or `apps/agent-web /remote`) driving the sidecar.
- Steps: in the GUI composer, type `/help` (or another command) and submit.
- Expected (after fix): the command runs remotely and its result renders in the GUI.
- Expected (before fix, contrast): `/help` is sent to the model as a prose message (the model tries to
  answer it) and no command executes.
- Cleanup: none.
- Evidence (fill in after implementation): GUI screenshot of a command result rendered from the wire.
