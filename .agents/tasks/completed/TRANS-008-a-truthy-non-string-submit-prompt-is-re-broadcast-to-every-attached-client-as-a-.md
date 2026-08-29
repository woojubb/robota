---
title: 'TRANS-008: a truthy non-string submit prompt is re-broadcast to every attached client as a typed frame'
issue: https://github.com/woojubb/robota/issues/2045
status: done
created: 2026-08-24
priority: medium
urgency: soon
area: packages/agent-transport-protocol
depends_on: []
completed: 2026-08-29
completed_by: https://github.com/woojubb/robota/commit/05c4f99c5
---

# TRANS-008: a truthy non-string submit prompt is re-broadcast to every attached client as a typed frame

## Objective

A `submit` frame whose `prompt` is a truthy non-string reaches the session, is re-emitted as a
`user_message`, and is delivered to every attached client inside a frame whose `content` is declared
`string`. One unguarded field lets a client put a shape-invalid value into a typed frame delivered to
its peers.

## Measured at `b9081fe7c`, before designing

Issue #2045 proposes a total runtime decoder for `agent-transport-protocol`. Its premise holds — the
package owns the unions and decodes nothing, and there are **three** cast sites, one more than the
issue lists:

```
ws-handler.ts:92                     JSON.parse(data) as TClientMessage
agent-transport-gui/…:66             JSON.parse(data) as TServerMessage
agent-transport-webrtc-web/…:118     parsed as TServerMessage        (not named in the issue)
```

`TClientMessage` has 24 variants, 14 carrying payload fields, and exactly **2** ad-hoc guards —
`!msg.prompt` and `!msg.name`, both falsy checks. So an unvalidated payload reaches every handler.

**What the consumers do with it is a separate question, and asking it changed the scope.**

- **`permission-response` — no harm.** `msg.result` reaches `resolvePermission` unvalidated, but
  `interpretApproval` (`agent-session/src/abortable-approval.ts:61`) compares by strict equality
  against `'allow-session'` / `'allow-project'` and otherwise returns `allowed: result === true`.
  Every malformed value denies. A decoder here would prevent nothing.
- **`ack` / `resume` — self-inflicted and bounded.** A non-numeric seq coerces to `false` and drops
  nothing; a huge one drops everything and the sender's next resume overruns into a full refresh.
  The buffer is separately bounded by frame count and bytes.
- **`submit.prompt` — the one that crosses.** `{}`, `[]`, `42`, `true` are truthy, pass
  `!msg.prompt`, and reach `session.submit(input: string)`. The execution controller then does
  `emit('user_message', displayInput ?? input)`, `ws-session-events.ts` marks `user_message` as
  `'forwarded'`, and it is delivered to **every** attached client — which accept it with
  `as TServerMessage` at both client cast sites.

So the harm is one field, and it is not the "one field" of a lost setting: it crosses from one client
to its peers through a frame the type system says is a string.

## Plan

- [x] TC-01 — a non-string `prompt` (object, array, number, boolean) is refused at the ingress and
      never reaches `session.submit`.
- [x] TC-02 — an EMPTY prompt is still refused. Control: a type check that replaced the falsy guard
      would otherwise admit `''`.
- [x] TC-03 — a real string prompt still submits. Control: a handler that refused everything would
      satisfy TC-01 without it.
- [x] TC-04 — MUTANT: the falsy guard restored goes red.
- [x] TC-05 — MUTANT: the type half alone (dropping emptiness) goes red on TC-02.
- [x] TC-06 — MUTANT: refusing everything goes red on TC-03.

## Not in scope, and deliberately

**The total decoder issue #2045 proposes is NOT resolved by this item and stays open.** This closes
the one measured crossing; it does not decide whether the package should decode. That disposition is
a data-correctness judgement and belongs to the owner.

**`rtc-responder-gate.ts` is untouched and still casts.** A decoder scoped to the file list in the
issue would leave it defective while reading as complete — recorded here because it survives whatever
is decided about the decoder.

**Thirteen of the fourteen payload-carrying fields were not traced to their use sites.** The ones the
issue names were. If another crosses the way `prompt` does, that is a finding for issue #2045, not a
widening of this diff.

## Test Plan

`packages/agent-transport-protocol/src/__tests__/submit-prompt-shape.test.ts` drives the real
`createWsHandler` ingress rather than the guard in isolation: the defect is what reaches the session,
not what a predicate returns. Gate commands: `pnpm build`, `pnpm typecheck`, the package suite,
`node scripts/harness/run-all-scans.mjs`, and `pnpm lint` read by exit code.

## User Execution Test Scenarios

**Not applicable — and the reason is the point, not a formality.**

This change is reachable only over the WebSocket protocol surface, and only by a client that sends a
frame the product's own clients cannot construct: every first-party client builds `submit` from a
string-typed input box or argument, so no supported user action produces a non-string `prompt`. The
scenario would require hand-crafting a malformed frame against a running host, which is a protocol
probe rather than a user execution.

The user-visible behaviour is unchanged by design: a real prompt still submits (TC-03) and an empty
one is still refused (TC-02). A scenario that exercised those would be verifying what this change
deliberately does not alter.

Recorded rather than omitted because `backlog-execution.md` requires the reason to be written — and
because three earlier records of mine omitted this section entirely, which is what made the omission
invisible.
