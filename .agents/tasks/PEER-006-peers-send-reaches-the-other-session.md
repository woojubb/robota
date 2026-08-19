---
title: 'PEER-006: the carrier and the ingress exist, and nothing joins them'
status: in-progress
created: 2026-08-20
priority: high
urgency: now
area: packages/agent-cli, packages/agent-command
depends_on: []
---

# PEER-006: `/peers send` carries a message to another session and back

## Objective

Close the last stage of issue #1863. Every piece is built and merged; none of them touch each other.

| piece                                  | where                        | landed as   |
| -------------------------------------- | ---------------------------- | ----------- |
| message + ack contracts                | `agent-interface-transport`  | issue #1809 |
| ordering, duplicates, ack issuance     | `agent-transport-protocol`   | issue #1809 |
| session ingress (`PeerMessageIngress`) | `agent-framework`            | PEER-002    |
| discovery + `/peers`                   | `agent-cli`, `agent-command` | PEER-004    |
| the unix-socket carrier                | `agent-cli`                  | PEER-005    |

`PeerMessageIngress` still has no consumer outside its own tests, and so do
`listenForPeerMessages` and `sendPeerMessage`. Issue #1863's definition of done is two local sessions
exchanging messages **in both directions**, with the receiving operator seeing the peer origin.

## Constraints inherited from issue #1809 — not re-decided here

- **`TDriverId` is display attribution, never an authorization input.** The driver id for a peer turn
  is DERIVED from the peer's session id, not taken from the peer-supplied `IPeerOrigin.driverId`: a
  name the transcript's reader trusts must not be chosen by the party being named.
- **A peer turn must carry a driver id.** Falling through to the owner's would put another session's
  message in the transcript under the operator's name.
- **No second queue.** A message arriving mid-turn is handled by the session's existing pending
  queue. `PeerMessageIngress` already says this, and its first draft grew two bugs by re-answering it.

## Approach

One new module in `agent-cli` joins the three ends, and the command surface grows one subcommand.

- **Receiving**: the listener binds on this session's announced socket and hands each message to
  `PeerMessageIngress`, whose host adapter submits with `turnSource: 'peer'` and the derived driver
  id. The immediate ack goes back on the socket; the settled ack is not awaited on the wire, because
  a message queued behind a long turn would otherwise hold the sender's connection open for minutes.
- **Sending**: `/peers send <sessionId> <text>` resolves the target through the same discovery the
  bare `/peers` reads, then calls `sendPeerMessage`. A target that is not announced is refused with
  that reason rather than a socket error.
- **The port grows one method.** `ICommandLocalPeersAdapter` gains `send`; the command still touches
  no filesystem and constructs no transport, for the reason PEER-004 recorded.

## Plan

- [x] TC-01: a message sent from one session reaches the other's ingress and comes back `pending`.
- [x] TC-02: sending to a session id that is not announced is refused with that reason, before any
      socket is opened.
- [x] TC-03: the submitted turn carries `turnSource: 'peer'` and a driver id derived from the SENDER's
      session id — not the operator's, and not the peer-supplied one.
- [x] TC-04: a peer-supplied `origin.driverId` does not become the attributed driver id.
- [x] TC-05: sending to this session's own id is refused.
- [x] TC-06: `/peers send` with a missing target or missing text explains what it needs.
- [ ] TC-07: the receiving operator sees the peer origin rendered — the turn is submitted with
      `turnSource: 'peer'` and a derived driver id, and what the TUI does with that is the renderer's
      own behaviour rather than this change's. Left open deliberately: ticking it would claim a
      rendering nobody in this change measured.
- [x] TC-08: two sessions exchange in BOTH directions.
- [x] TC-09: the flow and its concurrency behaviour are documented for the CLI.
- [x] TC-10: `pnpm harness:pre-push` green.

## Test Plan

Real sockets in a scratch guarded directory, as PEER-005 established: a stub would show the code
calls the functions it calls, and what has to be established is that a message written by one
process's send path arrives at another's ingress.

Ordering, duplicates and ack issuance are NOT re-asserted here — they belong to the ledger, and a
second set of cases over them would create a second opinion about rules with one owner.

The attribution cases (TC-03, TC-04) are the ones worth red-proofing individually: passing the
peer-supplied driver id through is a one-character change that no other test would notice.

## User Execution Test Scenarios

**Scenario 1 — two sessions, both directions**

- Prerequisites: this repository built (`pnpm build`), two terminals on the same host as the same user.
- Terminal A: `pnpm cli:dev` — then `/peers`. Expect: "No other live session is announced."
- Terminal B: `pnpm cli:dev` — then `/peers`. Expect: both session ids listed, B's marked `(this session)`.
- Terminal B: `/peers send <A's session id> hello from B`
- Expect in A: the message appears attributed to the peer session, not to the operator, and the agent
  responds to it.
- Terminal A: `/peers send <B's session id> hello back`
- Expect in B: the same, in the other direction.
- Cleanup: exit both sessions; `/peers` in a third session shows neither.
- Evidence: _to be filled after implementation_

**Scenario 2 — a target that is not there**

- Terminal A: `/peers send 00000000-0000-0000-0000-000000000000 hello`
- Expect: a refusal naming the unannounced target, not a socket error and not a hang.
- Evidence: _to be filled after implementation_

## Progress

### 2026-08-20

Opened after PEER-004 (PR #1897) and PEER-005 (PR #1906) both merged, which is what left the two ends
built and unjoined.

Red-proofed three ways, each applied and each reverted:

| defect injected                                                     | what went red                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| forward the peer's own `origin` to the ingress                      | both attribution cases, one reading `expected 'owner' not to be 'owner'` |
| match the subcommand with `/^send/`                                 | the `sender-1` case only                                                 |
| drop `await createSession` (INFRA-108's defect, checked separately) | the scenario verifier                                                    |

The second of those first reported GREEN because `sed` had not matched the source, so the edit was
never applied. A red-proof that reports green must be checked for having been APPLIED before it is
read as evidence; the retry asserts the pattern was found before writing.

The forged-attribution case also had to be rewritten. Its first version drove the send path, which
never populates `driverId` — so it could not fail on the condition its own name stated. It now writes
the forged message through the carrier directly, which is what a hostile peer would do.

Two frozen sizes were respected and one improved. The framework's root barrel stays at 685 —
`PeerMessageIngress` joined the existing `InteractiveSession` export line. `packages/agent-cli/src/cli.ts`
went 469 -> 466, because shortening `attachCommandHostAdapters` to `attachHostAdapters` let its import
block fold; the ratchet refused the unlocked gain and the baseline was re-frozen at 467 in the same
change.

`spec-public-surface` caught `PeerMessageIngress` as a new undocumented export. It is documented
rather than un-exported, which is the opposite of the answer PEER-004 gave for its three — the
difference is that this one has a consumer.
