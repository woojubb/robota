---
title: 'PEER-003: the mid-turn input queue coalesces last-wins per driver, which silently costs a peer conversation its earlier message'
status: todo
created: 2026-08-17
priority: medium
urgency: later
area: packages/agent-framework
depends_on: []
---

# PEER-003: last-wins coalescing is right for a typist and wrong for a conversation

Raised while implementing PEER-002 (#1809). Not a defect in what landed — it is a question about an
existing policy that a new input source now reaches, and the rule is that an argument against a rule
is the input to an amendment, never an exemption from it. So it is filed rather than worked around.

## The behaviour

`PendingInputQueue.enqueue` (REMOTE-014 E5) coalesces when an arriving input has the same
`driverId` as the queue's tail: the tail is replaced, and settled with `TTurnNotRunReason`
`'coalesced'`. The stated intent is "editable-pending, last-wins-per-driver semantics + caps a
single flooder", and for its original source — a human who typed again while a turn ran — that is
exactly right. The second thing they typed is what they meant.

PEER-002 submits an admitted peer message as a turn attributed to that peer. Two messages from ONE
peer arriving during a single running turn therefore coalesce, and the first one never runs.

## Why that is a different question for a peer

A person retyping is revising. A peer sending two messages is saying two things. Dropping the first
is not "last wins" — it is losing half of what was said, and the flooder-cap rationale is already
served by the queue's depth bound.

It is not silent, which is the one thing that keeps this at medium: the replaced entry settles with
`'coalesced'`, PEER-002 maps that to a refused ack with that exact reason, and the sending peer is
told. The conversation degrades visibly rather than quietly.

## What must NOT be done about it

- **Do not give each peer message a distinct `driverId` to dodge the tail check.** `TDriverId` is
  display attribution by contract. Using it to steer queue behaviour would make an attribution field
  load-bearing for control flow, which is the misuse its own contract warns against.
- **Do not give peer input a private queue.** That is the defect PEER-002's first draft shipped and
  its review caught: a second answer to a question this repository already answered, which
  immediately grew two bugs the original never had.

## The options worth weighing

| Option                                                  | Cost                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Coalesce only when the turn source is `'user'`          | Smallest change; makes the queue's policy depend on origin, which it currently ignores |
| Make coalescing a per-submission option the caller sets | Explicit at the call site; adds a field every submitter must now reason about          |
| Leave it, and document the ack the peer receives        | No code change; a two-message burst mid-turn keeps losing its first message            |

## Test Plan

| TC-ID | Test Type | Tool / Approach                                  | Notes                                                                        |
| ----- | --------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| TC-01 | Unit      | Two peer messages arrive during one running turn | Both run, in arrival order — the observable the chosen option must produce   |
| TC-02 | Unit      | Two user inputs during one running turn          | Still coalesces; the amendment must not regress REMOTE-014 E5                |
| TC-03 | Unit      | Queue depth bound with peer input                | The flooder cap still applies — this is not a licence for an unbounded queue |

## User Execution Test Scenarios

To be written with the implementation. Shape: two local `agent-cli` sessions, one sends two messages
in quick succession while the receiving session is mid-turn, and the operator sees both answered
rather than only the second.
