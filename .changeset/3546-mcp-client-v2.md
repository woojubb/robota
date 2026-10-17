---
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': patch
---

**`@robota-sdk/agent-mcp` opens every MCP session through one `@modelcontextprotocol/client` 2.x client, for both protocol eras.**

Legacy negotiation stays the default; `protocolVersion: '2026-07-28'` pins the same client to the
modern era and never falls back to the legacy handshake. The hand-written stateless framing is gone,
and so is the package's dependency on the `@modelcontextprotocol/sdk` 1.x runtime: the client and its
schema package (`@modelcontextprotocol/client`, `@modelcontextprotocol/core`) are now the package's
dependencies, and the 1.x SDK remains only as a test dependency for legacy-era fixture servers. The
guarantees are unchanged and still tested: an unsupported result (`input_required`, an unknown result
type) closes the carrier and is never replayed (no client input is offered, so the SDK's automatic
input round stays off), and the receive bound, redirect refusal, pinned sockets, authenticated retry,
trace propagation and stdio authority live in the package's own transport and fetch wrappers as before.

Two behaviors change on the pinned 2026-07-28 era, both following the official client:

- A result that omits `resultType` is refused (`invalid-tool-result` for a tool call) instead of being
  treated as complete. The tolerance served peers that predate the discriminator, which legacy
  negotiation serves.
- An invalid freshness hint on `server/discover` (`ttlMs` negative or fractional, `cacheScope` unknown)
  is read as the safest value (`ttlMs` 0, `cacheScope` private) instead of rejecting the server. List
  pages and resource reads with an invalid hint are still refused.
- An `input_required` result that carries neither `inputRequests` nor `requestState` is refused as
  `invalid-tool-result` rather than reported as `input_required`; either way the carrier closes and
  nothing is replayed.

Against a real 2026-07-28 host the pinned path now also sends the request headers the revision
requires (`Mcp-Method`, `Mcp-Name`), which the hand-written framing did not; a headers helper may no
longer set either, as it already could not set the other headers the transport owns. On the legacy
era the client no longer rejects `structuredContent` that violates the tool's declared `outputSchema`:
that check lived in the 1.x client's `listTools` cache, which per-page discovery does not fill, and
the catalog converts the result as before.

`@robota-sdk/agent-cli` adds `@modelcontextprotocol/client` and `@modelcontextprotocol/core` to its
external `dependencies` (it keeps the 1.x SDK, which `@robota-sdk/agent-transport-mcp`'s server still
uses) and updates its import-boundary test to the new package names.
