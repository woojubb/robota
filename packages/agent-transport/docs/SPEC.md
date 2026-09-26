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
  The access-token verifier trusts only keys no older than a bounded age; beyond that an issuer
  outage refuses rather than admits. Outbound delivery isolates carrier failures through a supplied
  error handler. No fallback transport is ever selected on behalf of a caller.
- Carriers supply `TOutboundDeliver` and an `IProtocolSession`; no carrier implementation is
  registered inside this package.
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
- Owns no socket, HTTP, WebRTC, terminal, framework-host, registry, or settings lifecycle.
- Session mobility owns handoff authority, offer refusal, and inventory classification; this package
  frames, seals, verifies, and assembles the payload that crosses a carrier.
- Does not forward another workspace package.
