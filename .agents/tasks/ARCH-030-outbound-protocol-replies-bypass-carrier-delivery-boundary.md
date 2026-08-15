---
title: 'ARCH-030: outbound protocol replies bypass the carrier delivery boundary'
status: todo
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-transport-protocol, packages/agent-transport-ws, packages/agent-transport-webrtc
depends_on: [ARCH-020, ARCH-028]
issue: https://github.com/woojubb/robota/issues/1734
---

# ARCH-030: unify outbound protocol reply delivery

## Problem

`createWsHandler` has two outbound delivery semantics. Session-event subscriptions use a
carrier-safe delivery boundary that reports failures through `onDeliveryError`, while replies to
inbound requests receive the raw carrier `send`. If a command, submit failure, background-log read,
job-group wait, or background-control operation finishes after disconnect, its Promise continuation
can throw from `send`, bypass carrier cleanup, and surface as an unhandled rejection.

The defect reproduces by starting a delayed remote command through a real handler, closing the WS or
WebRTC delivery carrier, and then resolving the command. The reply throws `WebSocket is not open` (or
the equivalent data-channel error), and the delivery-error observer receives nothing.

## Why this is foundational

Guarding one `.then()` callback would leave every sibling reply family and every future asynchronous
reply under the same split semantics. WS-001 previously recorded the same “send throws from a Promise
continuation” failure mode, so this is a recurring protocol-boundary defect rather than a local caller
mistake.

## Direction

- Define one connection-scoped outbound `TServerMessage` delivery boundary in the protocol handler.
- Route parse, query, control, prompt, background, session-event, and asynchronous continuation replies
  through that boundary without duplicating carrier callbacks.
- Keep transport lifecycle cleanup idempotent and isolate delivery-error observer failures.
- Preserve `SessionResumeBridge` sequence/buffer behavior and replay failed frames on the next sink.
- Add delayed-reply-after-disconnect regressions for protocol, WebSocket, and WebRTC carriers, including
  an explicit zero-unhandled-rejection assertion.

## Test Plan

- Protocol RED proof: resolve a delayed command after the injected send starts throwing; current code
  must produce an unhandled rejection and skip `onDeliveryError`.
- Repeat the delayed reply through real `WsSessionDelivery` and the WebRTC pairing/unpaired carrier
  lifecycle; assert one cleanup, one delivery-error notification, and no escaping rejection.
- Cover every Promise-continuation reply family mechanically or through a shared helper contract so a
  new raw-send continuation cannot be added silently.
- Run protocol, WS, WebRTC, browser-client, and resume-bridge suites plus typecheck, build, scenarios,
  `pnpm harness:scan`, and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

Applies. At scenario planning, author a maintained public-SDK example that starts a deterministic delayed
remote command, disconnects its local carrier, resolves the command, and prints structured evidence for
exactly one delivery error, committed operation success, cleanup, and zero unhandled rejections.

## Plan

- [ ] Author and approve a BEHAVIOR spec for the single outbound delivery boundary.
- [ ] Plan and gate the public-SDK delayed-reply scenario.
- [ ] Add the protocol RED proof and implement the shared delivery boundary.
- [ ] Wire WS, WebRTC, and resume paths through the boundary with lifecycle regressions.
- [ ] Synchronize package SPECs, README/content guidance, and changesets.
- [ ] Pass completion gates, archive the Task, and close issue #1734.

## Blockers

- ARCH-020 and ARCH-028 must land so the carrier failure lifecycle being unified is stable.

## Result

Pending.
