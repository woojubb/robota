# @robota-sdk/agent-transport — Package Specification

## Purpose

The pure transport-family substrate. It owns carrier-neutral wire messages, runtime decoders,
session-message dispatch, resumable delivery, peer-message state, handoff payload framing, file transfer, channel
framing, and Node-only admission, access-token verification and integrity helpers shared by
transport implementations.

## Contract

- **Transport admission: none.** This package defines and evaluates admission data but
  binds no listener itself — it is a substrate for admission decisions, not an admission point.
- Runtime message and frame decoders return explicit result unions rather than throwing.
- Admission, access-token and handoff integrity helpers return their declared result contracts.
  The resource-server gate every token-admitted HTTP carrier shares lives here, so the carriers
  cannot drift apart: names are checked against the public URL, refusals carry an empty body and only
  the standard challenge, and only failures count against a peer's address, which is reported only as
  a coarse class. A carrier composes it per request; the gate owns no listener.
  The access-token verifier trusts only keys no older than a bounded age; beyond that an issuer
  outage refuses rather than admits. Outbound delivery isolates carrier failures through a supplied
  error handler, and stops sending to a peer that stops reading, reporting it so the carrier can
  close that connection, instead of making the session wait for it. The session's full history,
  which only grows, crosses in bounded pages read one after another, and a turn's result leaves it
  out, so a peer that keeps reading is never taken for one that stopped. No fallback transport is
  ever selected on behalf of a caller.
- Carriers supply `TOutboundDeliver` and an `IProtocolSession`, and decide each connection's role;
  no carrier implementation is registered inside this package. An observing connection reads only its own
  session's conversation and state, plus the host's list of sessions: it cannot submit, answer,
  control, switch sessions, or read another session's records, and it never listens for prompts, so a
  session watched only by observers still fails its prompts closed at once. A connection that
  answers prompts can ask for the ones already open; they are kept only from what was forwarded to
  such connections, so keeping them never holds a prompt open that nobody can answer.
- A file crosses only after the receiver accepts its offer, and is kept only when the whole content
  matches the offered size and hash; anything else is discarded. The receiver paces the sender, so
  neither side holds more than a bounded window whatever the channel buffers.

## Boundaries

- The root and `./client` export graphs are browser-safe and depend only on interface packages.
- Node cryptography and network access are reachable only through `./node`, whose package export
  declares `"browser": null` — a structural guarantee that Node-only crypto never leaks into a
  browser bundle via the root or `./client` entries. Token signatures are checked by `jose`, not by
  hand-rolled crypto, and key discovery goes through the shared egress boundary rather than a
  private fetch, so one policy governs every outbound request.
- Owns no socket, HTTP listener, WebRTC, terminal, framework-host, registry, or settings lifecycle.
- Session mobility owns handoff authority, offer refusal, and inventory classification; this package
  frames, seals, verifies, and assembles the payload that crosses a carrier.
- Does not forward another workspace package.
