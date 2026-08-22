---
title: 'PEER-005: nothing carried a message between two local sessions'
status: done
created: 2026-08-19
completed: 2026-08-20
priority: high
urgency: now
area: packages/agent-cli
depends_on: []
---

# PEER-005: the carrier, and only the carrier

## Objective

Stage 2 of issue #1863's remaining scope. Everything above a carrier was already built and waiting
for one:

| Piece                              | Package                                  | State before this            |
| ---------------------------------- | ---------------------------------------- | ---------------------------- |
| Message + ack contracts            | `agent-interface-transport`              | built                        |
| Ordering, duplicates, ack issuance | `agent-transport-protocol` (the ledger)  | built                        |
| Session-side ingress               | `agent-framework` (`PeerMessageIngress`) | built, and called by nothing |
| Bytes between two processes        | —                                        | **absent**                   |

So the message could be shaped, judged and delivered into a session, and there was no way for one to
reach another. That is what this adds, and it adds nothing else.

## The decisions

**A unix socket inside the guarded directory.** The claim `same-user-same-host` rests on that
directory's ownership and mode, exactly as it does for the rendezvous. A socket inside a 0700
directory owned by this uid can be connected to only by that uid — or by root, which already controls
the process. Admission is established once, at bind time, by `admitLocalPeerSocket`, and never
re-derived per connection from something a peer chooses.

**The absent guarantee is stated, not implied.** Node's `net` exposes no `SO_PEERCRED`, so there is
no per-connection credential to read. The guarantee is the directory's. A comment claiming
per-connection verification would assert a property the code does not have — which is the defect
class this repository has spent the most review rounds on.

**One message per connection.** Connect, write one JSON line, read one line, close. A persistent
multiplexed stream needs framing, backpressure and a reconnect policy — three places to be wrong —
to carry a control message that is sent when a person types. Ordering across messages is the
ledger's `sequence`, never the socket's.

**The carrier forms no verdict.** `duplicate`, `refused` and `delivered` all come from the ledger and
are carried back untouched. A carrier that re-decided delivery states would give the sender a second
opinion about rules that must have exactly one owner.

**An unreadable message is answered with a `refused` ack, not dropped.** The sender is waiting, and
silence is indistinguishable from a peer that died mid-send — the exact distinction the delivery
states exist to make.

**A stale socket file is removed before binding.** A crashed session leaves the file with no listener
and `listen()` then fails with `EADDRINUSE`. Removing it is safe precisely BECAUSE the directory is
ours: nothing else could have put it there.

## Plan

- [x] TC-01: a message written by one side arrives at the other with its text and origin intact, and
      the receiver's ack comes back.
- [x] TC-02: `duplicate` and `refused` verdicts are carried through unchanged.
- [x] TC-03: two sessions on one directory exchange in both directions.
- [x] TC-04: binding is refused in a directory that is not 0700.
- [x] TC-05: sending to a path outside the guarded directory is refused BEFORE connecting.
- [x] TC-06: sending where nothing listens fails rather than hanging.
- [x] TC-07: an unreadable message is answered with a refusal.
- [x] TC-08: a socket file left by a crashed session is taken over.
- [x] TC-09: `pnpm harness:scan` green.

## Follow-on

Wiring this carrier to `/peers send` and to `PeerMessageIngress` is what issue #1863's definition of
done needs, and it is **not** this item's work — it was written here as an unchecked TC-10, which was
a mistake: a plan item is what this unit of work delivers, and an item nobody intends to do here
makes the record unclosable for a reason that is not real. It is stated as a follow-on instead, so
the fact survives without pretending this item is unfinished.

Tracked by issue #1863's remaining stage.

## Test Plan

REAL sockets in a scratch directory. A stubbed transport would prove the code calls the functions it
calls; what has to be established is that bytes written on one side arrive on the other, which is the
property the whole peer stack was waiting on and the one a stub cannot show.

Ordering, duplicates and ack issuance are deliberately NOT re-asserted here — they belong to the
ledger, and a second set of cases over them would create a second opinion about rules with one owner.

## Progress

### 2026-08-19

Red-proofed one defect at a time: removing the stale-socket cleanup fails exactly the crash-recovery
case, removing the receiver's admission check fails exactly the 0700 case, moving the sender's
admission after the connect fails exactly the containment case, and replacing the refusal ack with a
silent destroy fails exactly the unreadable-message case.

**One of these caught a case of mine that proved nothing.** The first crash-recovery test tried to
simulate a crash by closing a server and asserting around it, and passed whatever the code did — an
in-process server cannot be made to leak its socket path, because closing it unlinks. Writing the
stale FILE directly reproduces the state a crash leaves, which is more faithful than reproducing the
crash, and it fails the moment the cleanup is removed.

A second red-proof attempt reported a false all-green because the injected edit had not matched the
source. Re-running it with the substitution verified showed the case failing at the 10s read timeout,
as designed. Worth recording: a red-proof that reports green must be checked for having been APPLIED
before it is read as evidence about the test.
