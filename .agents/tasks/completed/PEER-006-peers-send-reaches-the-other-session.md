---
title: 'PEER-006: the carrier and the ingress exist, and nothing joins them'
status: done
created: 2026-08-20
completed: 2026-08-21
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
- [x] TC-07: the receiving operator sees the peer origin rendered. Left open by this change on
      purpose — ticking it would have claimed a rendering nobody here had measured — and closed by
      PEER-007 (issue #1915, PR #1935), which measured it: the receiving session rendered
      `peer:<sender-session-id>` against a control session that rendered `You:`, with the two labels
      mutually exclusive across the transcripts. Ticked on that measurement, not on this change's.
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
- Evidence: **EXECUTED 2026-08-20** against `feat/peer-origin-rendered` (PEER-007 merged into the same
  tree), two real `pnpm cli:dev` sessions driven through PTYs on this host as this user.

  A alone:

  ```
  System:
    No other live session is announced. Start a second session on this host, as this user, and it appears here.
  ```

  B, after A was already up:

  ```
  System:
    Live sessions:
      b8319b98-bb7b-486c-a499-cf1585b39e61  (this session)
      97ffafe3-f770-4877-90a4-bd86df6be010
    Send to one: /peers send <session-id> <message>
  ```

  `/peers send 97ffafe3-… hello from B` — what A rendered:

  ```
  peer:b8319b98-bb7b-486c-a499-cf1585b39e61:
    hello from B
  Robota:
    STUB-ACK: …
  ```

  The label carries B's session id exactly as `/peers` reported it, and the agent answered the peer's
  turn. B saw the delivery acknowledged: `97ffafe3-… has the message; it is waiting behind work already
running there.`

  **The control run is what makes this mean anything.** A separate session where the operator typed the
  message rendered `You:`. Counted across the two transcripts, the labels are mutually exclusive — the
  peer-driven transcript contains `peer:<id>:` and zero occurrences of `You:`; the operator transcript
  contains `You:` and zero occurrences of `peer:`. Without that second run the first only shows that a
  label appears, not that the two are told apart.

  **Both directions, run separately 2026-08-21.** Issue #1863's definition of done says _both_, and one
  direction only shows that a label appears — not that it names the right peer. A second pair:

  | direction | label the receiver rendered                 | sender's id from `/peers` |
  | --------- | ------------------------------------------- | ------------------------- |
  | B → A     | `peer:620c8924-9ee6-4058-9e65-2d0204b2a103` | B = `620c8924-…`          |
  | A → B     | `peer:dfad4f56-7bc3-4eb4-b1e2-e86f10960333` | A = `dfad4f56-…`          |

  Each session labelled the OTHER one. A single direction would pass even if the label were wired to
  the wrong end.

  Provider: no credential was present (probed: no `ANTHROPIC_*`/`OPENAI_*`/`GEMINI_*` in the
  environment, no `.env` — only `.env.example`, no settings under `~/.robota`, and no Ollama on
  :11434). A local OpenAI-compatible stub stood in so the sessions could reach a prompt. It serves the
  model call only; discovery, delivery and attribution are the product's own code and are what this
  scenario observes.

**Scenario 2 — a target that is not there**

- Terminal A: `/peers send 00000000-0000-0000-0000-000000000000 hello`
- Expect: a refusal naming the unannounced target, not a socket error and not a hang.
- Evidence: **EXECUTED 2026-08-20**, same pair of sessions:

  ```
  System:
    Not delivered to 00000000-0000-0000-0000-000000000000. no session 00000000-0000-0000-0000-000000000000
    is announced on this host. Run /peers to see which are.
  ```

  It names the target, says where to look, and returns immediately — no socket error, no hang.

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
