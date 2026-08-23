# SPEC.md — @robota-sdk/agent-interface-session-mobility

## Package Identity

- **npm name**: `@robota-sdk/agent-interface-session-mobility`
- **Layer**: Layer 2 — the dependency set that places it there is declared in this package's manifest
  and enforced by `check-dependency-direction.mjs`; not restated here. The layer itself is declared in
  [`.agents/specs/contract-family-owner-map.md`](../../../.agents/specs/contract-family-owner-map.md)
  and enforced by `scripts/harness/interface-layers.mjs` (ARCH-101).
- **SDK**: (none — contract declarations only)
- **Platform**: node

## Scope

This package owns **session mobility**: moving MESSAGES between live sessions (PEER-001), and moving
AUTHORITY over a session to another machine (HANDOFF-001).

They are one axis. A peer message and a handoff differ in what travels — data versus control — and
both answer the same question: what happens when a session is not confined to one process.

## Boundaries

| Concern                                  | Owner                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| What a session IS                        | `agent-interface-session`                                                             |
| Carrying a peer message over a wire      | `agent-transport-webrtc`, `agent-transport-protocol`                                  |
| Deciding whether a handoff is authorized | the host application; this package declares the shape of the decision, not the policy |
| Transport adapters, channels, admission  | `agent-interface-transport`                                                           |

**This package declares that authority CAN move and what that looks like. It decides nothing about
whether a given move is permitted** — `isHandoffCommitted` and `sourceRetainsAuthority` are
discriminators over a recorded state, not authorization checks.

## Architecture Overview

**Layer 2 — the highest in this family.** It composes `agent-interface-session`, which composes the
three layer-0 owners. Nothing names a type from here, which is what makes it the top: mobility is a
capability added over a session, never a thing a session is defined in terms of.

Three modules:

```text
session-mobility-contracts  →  peer-message-contracts, handoff-contracts
peer-message-contracts      →  agent-interface-session (TDriverId)
handoff-contracts           →  agent-interface-session (IInteractiveSessionRecord)
```

`session-mobility-contracts` is a sub-barrel over the other two, kept because they are one axis.

## Type Ownership

| Type                                              | Location                            | Purpose                                |
| ------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| `IPeerMessage` and the peer-delivery types        | `src/peer-message-contracts.ts`     | a message moving between live sessions |
| `isSameEnvironmentPeer`, `isTerminalPeerDelivery` | `src/peer-message-contracts.ts`     | discriminators over a delivery outcome |
| the handoff record and its state types            | `src/handoff-contracts.ts`          | authority moving to another machine    |
| `isHandoffCommitted`, `sourceRetainsAuthority`    | `src/handoff-contracts.ts`          | discriminators over a recorded handoff |
| the combined surface                              | `src/session-mobility-contracts.ts` | one sub-barrel over both families      |

21 declarations. `src/index.ts` is the single entry point; there is no subpath export, because this
family ships no test double.

## Public API Surface

| Export                   | Kind     | Description                                    |
| ------------------------ | -------- | ---------------------------------------------- |
| the type names above     | type     | contract declarations                          |
| `isSameEnvironmentPeer`  | Function | narrows a peer to one in the same environment  |
| `isTerminalPeerDelivery` | Function | narrows a delivery outcome to a terminal one   |
| `isHandoffCommitted`     | Function | narrows a handoff record to a committed one    |
| `sourceRetainsAuthority` | Function | reads whether the source still holds authority |

The four runtime values are **discriminators**, which the Interface Package Rule permits at the entry
alongside a contract's vocabulary. None of them decides policy.

## Extension Points

None by design.

## Error Taxonomy

| Error | Code | Category | Recoverable |
| ----- | ---- | -------- | ----------- |
| —     | —    | —        | —           |

This package declares no error type and throws nothing. A failed delivery is a delivery _outcome_,
discriminated by `isTerminalPeerDelivery`, and what follows is the caller's decision.

## Test Strategy

`src/__tests__/peer-message-contracts.test.ts` moved here with its declarations. The package otherwise
declares types and four discriminators, so the remaining assertion is that it compiles.

Its contracts are exercised by `agent-transport-webrtc` (browser peer), `agent-transport-protocol`
(the wire pair) and `agent-framework`.

## Class Contract Registry

None. This package declares no class, and `scan-interface-runtime` refuses one.
