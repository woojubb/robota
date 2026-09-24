# agent-mcp Specification

## Purpose

The MCP (Model Context Protocol) client-side owner for Robota SDK. It keeps three concerns
deliberately separate: **definitions** (what an MCP server IS — decoding, precedence, disable
overlays, redacted projections, identity/fingerprints; pure, nothing here connects or spawns),
**activation** (whether a definition may be used — admission, exact identity matching, a
replaceable approval/audit store), and **client, catalog and supervision** (the official
`@modelcontextprotocol/sdk` client behind an admit-then-construct transport seam, the canonical
tools/prompts/resources catalog, and the connection/catalog lifecycle supervisor). Discovered
tools enter the runtime through the existing generic tool slot (`IToolWithEventService`); no
MCP-only runtime path exists.

The hand-written JSON-RPC path that preceded the SDK client was removed rather than wrapped: it
had no discovery, and two client stacks cannot both be authoritative.

## Non-goals / Boundaries

- Allowed dependencies: `@robota-sdk/agent-core` (sole workspace peer; shared egress policy comes
  from its `./node` subpath) and `@modelcontextprotocol/sdk`. Must not import `agent-framework`,
  `agent-session`, `agent-cli`, or any other `agent-*` package.
- Does not own a tool registry, factory, or product client identity — the consumer (composition
  root or CLI) selects its protocol identity and wires tools at construction time.
- Transport set is Streamable HTTP and stdio only, behind an admit-then-construct seam. Deprecated
  HTTP+SSE and custom WebSocket are refusals surfaced in the catalog's rejected bucket, never
  adapters and never silent.
- MCP activation policy is transport-neutral and host-injected: this package owns the admission
  port, identity matching, and the approval/audit store, but does not decide workspace trust or
  read project/plugin files.

## Invariants and guarantees

- **URL admission**: the shared egress policy runs BEFORE any connection attempt; `http:` outside
  loopback, private ranges and cloud-metadata addresses are refused, and a redirect is refused
  rather than followed. There is no second admission path, so definition headers never reach a
  host the policy did not admit.
- **Stdio authority**: definitions cannot grant execution authority — only a host-owned authority
  can, and it is consulted before reading environment values, constructing the transport, or
  spawning. Absent `cwd` means the authority's allowed root, never the ambient process cwd; lexical
  `..`, NUL, non-directory paths and canonical paths outside the allowed root (including symlink
  escapes) are rejected, and both activation and cwd are rechecked immediately before spawn — this
  limits but cannot eliminate concurrent filesystem replacement. The child spawns with `shell:
false`; every `DEFAULT_INHERITED_ENV_VARS` key is explicitly shadowed rather than left to the
  SDK's default merge, though an empty baseline key remains present in the child. Stderr is drained
  without publishing raw bytes, and cleanup observes direct-child close within a bound but makes no
  process-tree termination guarantee.
- **Activation matching is exact**: server id, source/provenance, definition fingerprint, security
  identity and (for every source outside `managed`/`user`) repository identity and workspace
  generation must all match an approval; project/plugin sources cannot self-approve, and
  `requiresTrustedWorkspace` is deny-by-default.
- **Secrets are never hashed** in identity computation, so rotating a token does not invalidate an
  approval — fingerprints cover only what will run or where it came from, not secret values.
  Redacted projections carry `env`/`header` KEYS but never VALUES, because "configured but
  redacted" and "no header" must remain distinguishable answers; stdio command, argv and cwd are
  redacted wholesale.
- **A session is stateless about liveness by contract.** The SDK has no cancellation
  acknowledgment, so an abort or timeout of an active stdio request closes the direct child rather
  than pretending the in-flight call can be cancelled cleanly; a failed tool call is never replayed
  by the supervisor.
- **External event notifications are opt-in protocol facts, not turn authority.** The client only
  exposes an external-event notification from a server that declared that exact capability during
  initialization, and validates sender, conversation, and bounded content before delivery; an
  undeclared or unsupported server cannot deliver through this port. A subscribing host must
  separately authenticate/admit that server and its senders before submitting any session turn.
  Reconnection after an unexpected transport close is bounded and fails closed if the server drops
  the declaration; repeated disconnects eventually require an explicit retry rather than looping
  forever.
- **Discovery is bounded and honest**: an unsupported capability's list method is never called; a
  declared one is drained page by page until pagination ends, bounded by a page count and a
  per-request timeout; a partial catalog is never reported as complete.
- **Result-size metadata is a bounded, adapter-validated request, not a server-controlled policy
  override.** Only one vendor metadata key is interpreted, only within a fixed numeric range; a
  malformed or out-of-range value is ignored with a diagnostic rather than treated as permission to
  widen a result. An independent, transport-level receive cap (applied before SDK parsing) is a
  separate, smaller concern than the character-based admission cap: the receive cap limits local
  materialization, the admission cap limits model context.
- **Connection state carries its own failure classification.** Only `transient` failures retry,
  under bounded backoff; other classes surface for the caller to act on rather than looping
  silently. A stale catalog from a failed `list_changed` refresh is kept (marked `stale`) rather
  than emptied. A retained catalog is bound to an explicit identity (server id, negotiated protocol
  version, server version); a reconnect whose identity differs invalidates it.
- **The legacy protocol era is a recorded limit**: the pinned SDK generation speaks the
  pre-2026-07-28 protocol; a server that refuses the negotiated version is disconnected, not used.

## Design decision: narrowing, not refusing, third-party schemas

An MCP tool's `inputSchema` is authored by a third-party server. Handing an expressive-but-partial
schema to a strict validator unchanged would refuse _every_ payload for that tool once the schema
used a construct the universal subset cannot express — breaking a working tool over a limitation
that is this repo's, not the server's. So the validator narrows instead of refusing:
inexpressible property subtrees are _replaced_ with an accepts-anything node rather than deleted
(deleting a key from a closed object schema would turn the server's own declared parameter into an
"unexpected additional property" and refuse the payload for the opposite reason); `required` is
carried through untouched, because a narrowed property is one whose value cannot be checked, not
one that stopped being required; everything expressible is still enforced completely, including
nested objects and array items; and the dropped paths are reported once per tool (narrowing is a
pure function of a schema that does not change), because silence here would be a downgrade nobody
could see.

## Error semantics

Refusals and failures are typed and secret-free: transport admission, stdio authority, and session
errors carry a reason without raw command values, argv, or stderr text. Errors are never silently
swallowed — a discovery failure, a rejected catalog entry, and a connection failure are all
surfaced as classified results a caller can branch on, not thrown as opaque exceptions or dropped.
