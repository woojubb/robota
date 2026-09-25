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
- **Precedence fails closed on the managed tier, not just per name**: a malformed highest-precedence
  entry already resolves `unresolved` rather than falling through to a lower source; when the
  managed tier cannot be read AT ALL (its configuration root, `mcpServers`, or its whole document is
  unusable), every name that would otherwise resolve from a LOWER tier is blocked the same way,
  because a name the managed policy would have defined is indistinguishable from one it never
  mentioned — a name already resolved from a different, readable managed origin is unaffected. A
  source-level problem in any other tier is informational only — reported beside the servers that
  still resolve normally.
- **Authentication is bound to one server and never optional once asked for**: a host registers an
  authenticator for one server identity, and the HTTP transport asks it for headers on every
  request to that server only, after admission — never across a redirect, which stays refused.
  Its headers override a static header of the same name and never enter a projection, log, audit
  record or error. A refused credential is retried at most once, with fresh authorization, and
  only when the authenticator allows it; a failure is a typed, content-free refusal, and there is
  never an unauthenticated attempt. A definition that declares authentication this version cannot
  perform, or a header helper the host does not allow, stays listed and is refused by name, rather
  than connected with its static headers alone. A header helper is an exact argv the host runs, never
  a shell line or a template, so the host can allow one command line rather than a program; its
  output is parsed strictly, may not set a header the transport or protocol owns, and is obtained
  once per connection and once more after the server refuses them — however many requests
  were refused together.
- **Trace context stays on the call it belongs to**: a tool call's trusted `traceparent` goes only on
  that call's own `tools/call` POST and the cancellation of it, and only to an exactly listed origin.
  The decision is made from each request's body, not from the async context, because the SDK runs a
  call's response stream — and any `list_changed` refresh or reply it triggers — inside that context;
  the admitted headers are never modified, so nothing carries over to another request.
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
- **One principle decides what is secret**: a value is secret because of what it is — a stretch a
  credential-shaped variable produced (its default included), or a value under a credential-shaped
  env or header key — not because of which field carries it. Materialization records which
  stretches came from which variable, and every consumer reads that record.
- **Secrets are never hashed, and everything else is**: the definition fingerprint covers every
  value that decides what runs or where it connects, env and header values included, with each
  secret replaced by a marker naming its source. A changed `NODE_OPTIONS` value or a changed host
  invalidates an approval on every transport; rotating a credential does not.
- **Nothing printed carries a secret**: the activation endpoint and a projected URL show their
  secret stretches replaced, and transport errors name origins only. Redacted projections carry
  `env`/`header` KEYS but never VALUES, because "configured but redacted" and "no header" must
  remain distinguishable answers; stdio command, argv and cwd are redacted wholesale, because a
  literal credential there has no variable or key to reveal it.
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

## Design decision: definition precedence, with plugins last

A server name resolves to one whole entry from the highest source that defines it: `managed`,
then `local`, `project`, `user` and `plugin`. Entries are never field-merged, and a malformed
winner still shadows the name rather than handing it down. Plugins rank last because a plugin is
the least-trusted source and plugin server names are not namespaced: ranking it above `user`
would let an installed plugin silently replace a server the user configured under the same name,
while ranking it last still lets a plugin add servers under names of its own. Claude Code ranks
plugin-provided servers above user scope; Robota deliberately does not.

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
