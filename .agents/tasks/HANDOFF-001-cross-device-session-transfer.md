---
title: 'HANDOFF-001: moving a live session to another computer needs an ownership transaction, and there is no atomic commit across two machines'
status: in-progress
created: 2026-08-17
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-transport-protocol, packages/agent-framework, packages/agent-cli
depends_on: ['SEC-011']
---

# HANDOFF-001: transferring a session, without ever making ownership ambiguous

Registered as [issue #1811](https://github.com/woojubb/robota/issues/1811), the functional child of
[#1808](https://github.com/woojubb/robota/issues/1808). The security sibling is
[#1812](https://github.com/woojubb/robota/issues/1812), implemented as `SEC-011` (in flight on its
own pull request at the time of writing, so it is named rather than linked). It supplies the
authorization this transfer consumes, and this item must not re-decide it.

## The instruction that shapes the design

The issue names the reuse to avoid, and it is the same shape PEER-001 met:

> _"Do not reuse `SessionResumeBridge` as the hand-off contract: it is a connection-reconnect buffer
> for sequenced server messages, not a durable cross-device ownership transaction."_

A resume buffer replays messages a client missed. A hand-off moves **authority** — after it, one
machine must be in charge and the other must not be. Similar surfaces, different meanings, and
widening the first into the second is how a session ends up half-owned.

## The hard part: there is no atomic commit across two machines

The acceptance criteria ask for two things that cannot both be literally true at one instant:

- _"The source remains authoritative until the destination verifies and persists the transfer."_
- _"The source is not marked handed off until the destination acknowledgement is durable."_

Between the destination persisting and the source learning that it did, the network can drop. That
window cannot be removed — it is the two-generals problem — so the design must make it **harmless**
rather than pretend to close it.

**The rule that makes it harmless: the source only ever gives up authority on evidence it holds.**
Every failure mode resolves the same way — the source stays authoritative — and the destination
refuses to act on a transfer it cannot prove was committed. A duplicate arrival is idempotent by
`handoffId`, so a retried commit is not a second hand-off.

That yields a phase order where every crash point is safe:

| Phase          | Source state  | Destination state                    | If it dies here                                    |
| -------------- | ------------- | ------------------------------------ | -------------------------------------------------- |
| `offered`      | authoritative | nothing                              | nothing happened                                   |
| `transferring` | authoritative | receiving into a staging area        | destination discards; source unaffected            |
| `staged`       | authoritative | complete, verified, **not yet live** | destination discards on timeout; source unaffected |
| `committed`    | read-only     | live                                 | the transfer succeeded                             |
| `abandoned`    | authoritative | discarded                            | explicit, at either end                            |

The only irreversible step is the destination's commit, and the source's read-only transition is
driven by the destination's durable acknowledgement of exactly that.

## What moves, what is rebuilt, and what stays

The issue requires each of these to be classified explicitly rather than left to implementation.
`IInteractiveSessionRecord` is the inventory foundation it names, and it already carries most of the
transferable half.

| State                                                | Classification                                | Why                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation messages, history, session metadata     | **Transferred**                               | The session IS this; already in `IInteractiveSessionRecord`                                                                                                                                                                                                                         |
| Goal/plan state, background task and job-group state | **Transferred**                               | Part of what the user would lose                                                                                                                                                                                                                                                    |
| Provider credentials                                 | **Never transferred**                         | SEC-009 established that a resolved secret must not cross a process boundary; a machine boundary is strictly worse. The destination resolves its OWN credential from its own environment, and a hand-off to a machine without one fails loudly at commit rather than silently later |
| Working directory path                               | **Transferred as a REFERENCE, rehydrated**    | The path is meaningless on the destination. It is carried so the destination can locate or ask for the corresponding checkout, and a mismatch is surfaced, not guessed                                                                                                              |
| Uncommitted working-tree changes                     | **Left on the source**                        | Moving them would make the hand-off a file-sync product. Their existence is reported to the user at both ends so the choice is theirs                                                                                                                                               |
| Running subprocesses                                 | **Left on the source**                        | A process cannot migrate; pretending otherwise would resume a session whose tools point at dead pids                                                                                                                                                                                |
| In-flight model call                                 | **Left on the source, and must SETTLE first** | A turn in flight has an outcome that belongs in the history being transferred. The hand-off waits for it or refuses to start                                                                                                                                                        |
| In-flight tool calls                                 | **Left on the source, settled first**         | Same reason, and a half-run tool is worse than an unstarted one                                                                                                                                                                                                                     |
| Sandbox snapshot id                                  | **Transferred as a reference**                | Already a reference in the record; validity on the destination is checked, not assumed                                                                                                                                                                                              |

## Ownership boundaries (from the issue, restated only as a routing note)

Semantic SSOT `agent-interface-transport`; wire SSOT `agent-transport-protocol`; orchestration
`agent-framework`; carrier `agent-transport-webrtc` consuming SEC-011's result; `agent-cli` owns
commands, consent UX and composition only.

## Implementation status

The wire layer is complete; the orchestration is not. What has landed, and where:

| Piece                                                                | Package                     | Change  |
| -------------------------------------------------------------------- | --------------------------- | ------- |
| Phase contracts and `sourceRetainsAuthority`                         | `agent-interface-transport` | earlier |
| The ownership transaction — every failure keeps the source in charge | `agent-transport-protocol`  | #1835   |
| Manifest, inventory classification, integrity seal/verify            | `agent-transport-protocol`  | #1843   |
| Chunking and reassembly                                              | `agent-transport-protocol`  | #1856   |

**TC-01, TC-05, TC-06, TC-08 and TC-09 were covered by the wire layer.** TC-02, TC-03, TC-04, TC-07
and TC-10 are covered now, by the orchestration below — they are about what the source and
destination DO across a real transfer, not about the frames.

| Piece                                                                     | Package                             | Change      |
| ------------------------------------------------------------------------- | ----------------------------------- | ----------- |
| `HandoffSource` / `HandoffDestination` and the `IHandoffComposition` port | `agent-framework`                   | issue #1864 |
| `createHandoffComposition` — the one file where the two names meet        | `agent-cli`                         | issue #1864 |
| `ICommandHandoffAdapter`, and `/handoff` with its consent prompt          | `agent-framework` + `agent-command` | issue #1864 |

### The edge that was NOT added

The orchestration composes the wire layer, and `agent-framework` does not depend on
`agent-transport-protocol`. Every consumer of that package is a transport package or a composition
root, and ARCH-021 is the precedent for keeping an assembly package clear of such an edge by having
the root supply the collaborator — `agent-subagent-runner`'s `agent-builtin-providers` dependency was
DELETED for exactly this reason. So `IHandoffComposition` names the five operations the orchestration
needs, and `packages/agent-cli/src/handoff/handoff-composition-root.ts` is the only file in the tree
where `@robota-sdk/agent-framework` and `@robota-sdk/agent-transport-protocol` appear together.

### Found while wiring it: the seal is `JSON.stringify`, so a `Date` does not survive

`IUserMessage.timestamp` is a `Date`. `sealHandoffRecord` serialises with `JSON.stringify`, so every
message timestamp arrives at the destination as an ISO **string**, and `JSON.parse` does not turn it
back. The transfer is byte-exact — the digest proves that — and the object it reconstructs is not the
object that was sent.

Not fixed here, because it belongs to the seal rather than to the orchestration, and changing what
the seal produces changes what the digest covers. Recorded rather than smoothed over: the
orchestration tests use a real `Date` in their fixtures precisely so this stays visible, and a
destination that resumes a session and reads `timestamp.getTime()` is the case that would find it.

### What remains, and where it lives

The CARRIER. `/handoff` is registered in the default module set and answers a host without one by
saying so — a better state than a capability nobody can see, and it is what makes the carrier's
arrival observable. Wiring it is issue #1865 (`agent-transport-webrtc` + `agent-cli`), which owns the
cross-device grant this transfer consumes.

One classification changed during implementation and the table above still reflects the original
wording. `THandoffDisposition` gained `never-transferred`, split from `source-local`, because the two
were not the same statement: uncommitted working-tree changes stay behind as a product decision that
could be revisited, while a provider credential stays behind because SEC-009 forbids a resolved
secret crossing a process boundary — and a machine boundary is strictly worse. Collapsed together,
nothing in the type would stop a later change from helpfully carrying the credential along.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                | Notes                                                                                   |
| ----- | ----------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TC-01 | Unit        | Manifest round-trip with integrity metadata                    | The transferable inventory, proven against the record type                              |
| TC-02 | Unit        | Commit acknowledgement is durable before source goes read-only | The core ordering; asserted on persistence, not on a message being sent                 |
| TC-03 | Unit        | Disconnect during `transferring`                               | Source authoritative, destination discards                                              |
| TC-04 | Unit        | Disconnect after destination commit, before ack arrives        | The unavoidable window: source stays authoritative, and a re-delivered ack completes it |
| TC-05 | Unit        | Duplicate hand-off request with the same `handoffId`           | Idempotent, not a second transfer                                                       |
| TC-06 | Unit        | Corrupt or truncated chunk                                     | Integrity check fails; nothing is staged                                                |
| TC-07 | Unit        | Destination has no provider credential                         | Fails at commit, loudly, with the source unaffected                                     |
| TC-08 | Unit        | In-flight turn at hand-off start                               | Refused or awaited; never transferred mid-turn                                          |
| TC-09 | Unit        | Cancellation at each phase                                     | Source usable and authoritative in every case                                           |
| TC-10 | Integration | Two in-process sessions, full transfer and resume              | The observable the acceptance criteria describe                                         |

## User Execution Test Scenarios

To be written with the implementation, and the shape is already fixed by the design: two `agent-cli`
processes on one machine acting as source and destination, a transfer completed, and the source
observably read-only afterwards. Provider-free — the destination's credential requirement is what
TC-07 exercises deliberately, so the happy-path scenario uses a deterministic provider on both ends.
