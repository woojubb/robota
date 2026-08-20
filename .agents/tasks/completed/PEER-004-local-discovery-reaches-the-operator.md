---
title: 'PEER-004: local peer discovery was built and called by nothing'
status: done
created: 2026-08-19
completed: 2026-08-21
priority: high
urgency: now
area: packages/agent-cli, packages/agent-command, packages/agent-framework
depends_on: []
---

# PEER-004: announce this session, and let the operator see the others

## Objective

The first stage of issue #1863's remaining scope: make local peer discovery real and observable.

## The measurement this started from

Two leaves had landed — a guarded rendezvous directory (issue #1810, issue #1862) and a registry
whose liveness is settled by pid AND process start time (issue #1863) — and **no source outside those
modules and their own tests called either one.** Measured before writing anything: `announcePeer`,
`listPeers` and `openLocalPeerRendezvous` had zero consumers.

That is the "declared but never wired" defect this repository has now met four times, and the
uncomfortable part is that PR #1883's closing note for issue #1862 warned about exactly it while
leaving this instance in place. A composition test over the leaves proves the leaves compose; it does
not prove the running program calls them.

## What landed

| Piece                                | Where                                                            |
| ------------------------------------ | ---------------------------------------------------------------- |
| The port the command reads           | `ICommandLocalPeersAdapter` in `agent-framework`                 |
| `/peers`                             | `agent-command/src/peers/`, registered in the default module set |
| Announce, list, withdraw-on-exit     | `announceLocalPeerPresence` in `agent-cli`                       |
| The one line at the composition root | `attachCommandHostAdapters`                                      |

## The decisions worth carrying forward

**Withdrawal is bound to the process ending, not to a timeout.** A session that exits normally removes
its own entry, so the common case never depends on the liveness floor. The floor is for crashes.
Leaning on the detector instead would make every clean exit look like a crash until something noticed.

**`unknown` liveness is printed, never rounded to `alive`.** A host that cannot read process start
times answers `unknown` for every peer. Rounding it at the surface would reintroduce, in the display,
exactly the guess the registry refuses to make.

**A refused rendezvous is reported, not swallowed, and does not stop the session.** `/peers` then says
the feature is unavailable rather than claiming nobody is there. Those are different facts and the
operator acts on the difference: "nobody is there" invites starting a second session, and this does
not.

**The reporter is an object, not a bare function.** An unbound `terminal.writeError` loses its
receiver at the one moment it is needed — while reporting a failure.

**The session id is generated at the assembly point.** It identifies this process for its whole life
and has no other source; taking one from a caller would let two call sites disagree about what a
session is, which is the question the registry keys its entries on.

## Plan

- [x] TC-01: two presences on one directory each see the other and themselves.
- [x] TC-02: `unknown` liveness survives to the surface.
- [x] TC-03: a fired exit removes the entry; `withdraw` is idempotent and unsubscribes.
- [x] TC-04: `/peers` lists others, marks this session, hides `dead`, prints `unknown`.
- [x] TC-05: `/peers` distinguishes "no other session" from "discovery unavailable".
- [x] TC-06: the assembly wires the adapter, generates the id, and reports a refusal without
      throwing or taking the other adapter down with it.
- [x] TC-07: `pnpm harness:scan` green and the three touched packages' suites green.
- [x] TC-08 (user-execution): two `agent-cli` sessions on one host, `/peers` in each showing the
      other. Executed 2026-08-20 — evidence below.

## User Execution Evidence

**TC-08, executed 2026-08-20.** Two real `pnpm cli:dev` sessions driven through PTYs, same host, same
user.

The first, alone:

```
No other live session is announced. Start a second session on this host, as this user, and it
appears here.
```

Once the second was up, its `/peers`:

```
Live sessions:
  b8319b98-bb7b-486c-a499-cf1585b39e61  (this session)
  97ffafe3-f770-4877-90a4-bd86df6be010
```

TC-05's distinction is what the first output shows: "no other session" reads as its own sentence with
a next step, not as an empty list a reader would have to interpret.

Full transcripts and the `/peers send` half, including both directions, are recorded in
[PEER-006](PEER-006-peers-send-reaches-the-other-session.md).

## Test Plan

Both directions everywhere, and the composition case is the one that matters: removing the wiring
line turns three cases red, which is the property the leaves lacked.

## Deliberately not in this change

`/peers send`. Nothing yet carries a message between two local sessions — `PeerMessageIngress` also
has no consumer outside its own package — so a `send` subcommand would be a surface over an absent
path. Issue #1863's definition of done needs it, and it needs a local channel first; that is the next
stage, and the guarded directory this stage already establishes is where its socket belongs.

## Progress

### 2026-08-19

Three harness ratchets caught real defects, and each was fixed by doing what it said rather than by
regenerating a baseline:

- `orphan-exports` caught the adapter builder exported and called by nothing — the same defect as the
  item itself, one level in. It also caught `buildRemoteControlHostAdapter` becoming unused once
  `attachCommandHostAdapters` absorbed its call site; both are module-private now.
- `file-size` refused `cli.ts` growing past its frozen 470. "Split instead of extending" is the
  rule's own instruction, and the split is real: adapter assembly moved into the module that already
  knew how, and the root now spends ONE line on it — a net change of zero.
- `spec-public-surface` refused four new undocumented package exports. Documenting them in the module
  tables did not clear it, which is the useful signal: those tables are not the surface the scan
  reads. The right answer was to stop exporting them — the command is registered by default, so
  nothing outside constructs one — and the package barrel now exposes only the module factory.

The framework's root barrel is at its frozen size (ARCH-038, issue #1806), so the new types are not
re-exported there; both consumers derive the row type from `ICommandHostAdapters`, which is stricter
than a second import would be because it cannot drift from the adapter it feeds.
