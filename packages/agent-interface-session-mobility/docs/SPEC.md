# SPEC.md — @robota-sdk/agent-interface-session-mobility

## Purpose

This package owns **session mobility**: moving messages between live sessions (peer messaging),
and moving authority over a session to another machine (handoff). They are one axis — a peer
message and a handoff differ in what travels, data versus control — and both answer the same
question: what happens when a session is not confined to one process.

This package orchestrates source and destination handoff around host-supplied delivery, record
decoding, and durable persistence. It declares how authority moves, whether a settled session may
be offered, and how its resources are classified in the handoff inventory. The source retains
authority until it holds a matching acknowledgement of durable destination persistence. Illegal
phase transitions are refused without changing state; repeated acknowledgements for a committed
handoff are idempotent. Authorization of a proposed move remains a host decision.

## Boundaries

| Concern                                  | Owner                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| What a session IS                        | `agent-interface-session`                                                             |
| Carrying a peer message over a wire      | `agent-transport-webrtc`, `agent-transport`                                           |
| Sealing and verifying handoff payloads   | `agent-transport`                                                                     |
| Deciding whether a handoff is authorized | the host application; this package declares the shape of the decision, not the policy |
| Transport adapters, channels, admission  | `agent-interface-transport`                                                           |

## Design decisions

- **Layer 2 — the highest in this family.** It composes `agent-interface-session`, which composes
  the layer-0 owners; nothing names a type from here. Mobility is a capability added over a
  session, never a thing a session is defined in terms of.
- **One authority transaction.** Phase transitions and the source-authority predicate live here,
  independent of transport delivery. Losing a connection before a durable commit acknowledgement
  leaves the source authoritative.
- **Settled, explicit offer.** Active model and tool work prevents a handoff offer. The inventory
  reports resources that stay local or require destination resolution as well as transferred state;
  provider credentials never cross the boundary.

### Peer messaging — two axes that must not collapse

A peer message is **not** the same as a remote-driver message: a driving message is asymmetric —
one party operates, the other is operated — while a peer message is symmetric, two sessions each
with its own agent, neither driving the other. Conflating the two would make them indistinguishable
at the point a session decides how much authority the sender has.

Admission answers two independent questions, carried separately rather than collapsed into one
boolean:

- **What did the peer present?** A token, or an explicit open decision — possession, and
  possession is copyable.
- **Where did the peer come from?** An environment proof the OS enforces — evidence with nothing
  to copy.

The resulting trust classification distinguishes "same user, same host" (produced by a
kernel-enforced rendezvous) from "token only" (a credential was presented and nothing about origin
was proven); the two are not interchangeable however convenient a single flag would be.

The driver-id attribution on a peer message is **display and attribution only** and must never
become an authentication or authorization input.

## Non-goals

- No handoff policy extension points; hosts supply effects, not authority decisions.
- Declares no transport failure taxonomy; recoverable handoff failures are explicit outcomes, while
  invalid local call order is a programming error.
