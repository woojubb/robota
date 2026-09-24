# @robota-sdk/agent-transport — Package Specification

## Purpose

The pure transport-family substrate. It owns carrier-neutral wire messages, runtime decoders,
session-message dispatch, resumable delivery, peer-message state, handoff payload framing, channel
framing, and Node-only admission/integrity helpers shared by transport implementations.

## Contract

- **Transport admission (SEC-008): none.** This package defines and evaluates admission data but
  binds no listener itself — it is a substrate for admission decisions, not an admission point.
- Runtime message and frame decoders return explicit result unions rather than throwing.
- Admission and handoff integrity helpers return their declared result contracts; outbound delivery
  isolates carrier failures through a supplied error handler. No fallback transport is ever
  selected on behalf of a caller.
- Carriers supply `TOutboundDeliver` and an `IProtocolSession`; no carrier implementation is
  registered inside this package.

## Boundaries

- The root and `./client` export graphs are browser-safe and depend only on interface packages.
- Node cryptography is reachable only through `./node`, whose package export declares
  `"browser": null` — a structural guarantee that Node-only crypto never leaks into a browser
  bundle via the root or `./client` entries.
- Owns no socket, HTTP, WebRTC, terminal, framework-host, registry, or settings lifecycle.
- Session mobility owns handoff authority, offer refusal, and inventory classification; this package
  frames, seals, verifies, and assembles the payload that crosses a carrier.
- Does not forward another workspace package.
