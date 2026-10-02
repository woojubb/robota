# @robota-sdk/agent-mcp

The Model Context Protocol (MCP) client for the Robota SDK: everything needed to let an agent use tools
from external MCP servers. It keeps three concerns separate:

- **Definitions** — what an MCP server is: decoding configuration entries, environment templates,
  precedence between configuration sources, disable overlays, redacted projections for display, and the
  identity and fingerprint an approval is tied to. Pure; nothing here connects or spawns.
- **Activation** — whether a definition may be used: a deny-by-default admission port, exact identity
  matching, and a replaceable approval and audit store. The host decides workspace trust.
- **Client, catalog and supervision** — the official `@modelcontextprotocol/sdk` client behind an
  admit-then-construct transport seam, the canonical catalog of discovered tools, prompts and resources,
  and a supervisor for the connection and catalog lifecycle.

Transports are Streamable HTTP and host-authorized stdio. Discovered tools enter the agent through the
ordinary tool slot, so there is no MCP-specific runtime path. The agent runtime CLI uses this package for its
`mcpServers` configuration; see the [MCP guide](../../content/guide/mcp.md) for that side. To expose a
agent session _as_ an MCP server, use
[`@robota-sdk/agent-transport-mcp`](../agent-transport-mcp/README.md).

Tool results retain ordered resource links, embedded text or binary resources, and inline audio
alongside structured state, including failed observations. Resource URIs remain opaque references;
receiving a link never fetches or activates it. Adapters without native resource/audio support project
resource text and explicit binary/audio limitations into the linked tool response. Binary bytes remain
in the typed receipt and persisted session; these text projections do not claim native audio delivery.
The complete result envelope counts toward the host's admission bound and is preserved when spilled.

## Explicit stateless wire surface

SDK hosts can pass `protocolVersion: '2026-07-28'` to `openMcpSession` after normal transport admission.
A server definition can also select this path with `protocolVersion: '2026-07-28'` on HTTP or stdio.
Omitting it preserves the legacy handshake. Protocol changes invalidate existing activation approvals;
management projections retain the selected version. Unsupported versions or carriers are refused by name. The selected path sends `server/discover` and includes
protocol version, client identity and empty optional client capabilities in every request. The HTTP
header matches the body; an unsolicited legacy session header is never inherited. Selection cannot
grant process/network authority or fall back to replay a mutation on another protocol.

The wire contract is pinned to the [official schema at revision
046fa30](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/046fa30efd374370afb87ef830bd788eac5f217e/schema/2026-07-28/schema.ts).
The locked v1 SDK supplies framing and existing result validators; its `Client` initialization is
bypassed for this path. Review of SDK 1.31.0 confirms its latest protocol remains 2025-11-25, so an SDK
version upgrade alone would not implement this wire change.

Discovery validates and exposes each page's `ttlMs`, `cacheScope` and host receive time, plus the
server discovery hint. These values are freshness hints, not integrity or authority. Retained catalog
identity includes a fresh carrier generation, preventing private data reuse across reconnects.
If optional server information is absent, the configured server ID labels the source and the version
is empty with `serverInfoProvided: false`; no external revision is invented.

This initial SDK surface supports declared tools, prompts and resources discovery plus completed
tool calls. `compatibilityDiagnostics` identifies unavailable MRTR client input, subscription watches
and unselected optional extensions. Unsupported result types close the carrier and require operation inspection;
they never become successful tool observations or cause automatic replay. A deadline or abort also
closes uncertain execution. Hosts must refresh lists explicitly; this does not implement automatic
TTL-based catalog refresh. Reading a generic resource cannot activate a skill.

### Opt-in Skills wire view

SDK hosts can additionally pass `skills: true` to `openMcpSession`. This requires the explicitly
selected stateless protocol and the server's valid Skills extension and Resources capability.
`session.skills` is otherwise absent, with a compatibility diagnostic when requested but unavailable.
The [Skills extension](https://skills.extensions.modelcontextprotocol.io/specification/stable/skills)
defines the metadata and complete file manifests used here.

`skills.list({ maxPages })` reads metadata only; `skills.get(uri)` confirms an explicitly referenced
skill even after an empty listing. Entries retain the server identity, carrier generation, complete
frontmatter and content fingerprint. `skills.read(entry, fileUri)` lazily verifies the requested
file's raw byte size and SHA-256 before returning it. Refreshes invalidate old manifests; malformed or
changed bytes require a fresh manifest. Dynamic manifests are exposed but verified reads are refused.
The host's opt-in enables bounded file responses supporting 512 files and a 16 MiB raw manifest,
including JSON/base64 framing; ordinary metadata and tool responses retain their existing receive limit.

This SDK view grants no instruction activation or tool permissions. A host must separately compare
the loaded YAML frontmatter with the advertised metadata, require explicit content-bound user consent,
preserve server-plus-URI identity in registry/approvals/caches, and revoke consent when content changes.
Nested `SKILL.md` files are supporting bytes until separately approved. CLI/app skill activation and
optional directory reads are not provided by this wire view.

## Installation

```bash
npm install @robota-sdk/agent-mcp @robota-sdk/agent-core
```

Requires Node.js 22.12 or later. `@robota-sdk/agent-core` is a peer dependency.

## Usage

Admit a transport, open a session inside a connection supervisor, discover the server, build the
catalog, and turn each discovered tool into a runtime tool:

```ts
import {
  createStreamableHttpAdapter,
  openMcpSession,
  MCPConnectionSupervisor,
  buildCatalog,
  createDiscoveredTool,
} from '@robota-sdk/agent-mcp';

const adapter = createStreamableHttpAdapter();
const admission = await adapter.admit({ url: 'https://example.com/mcp' });
if (!admission.ok) {
  throw new Error(`${admission.reason}: ${admission.message}`);
}

const timeouts = {
  startupMs: 10_000,
  perCallMs: 30_000,
  globalDefaultMs: 30_000,
  idleMs: 60_000,
  toolCallMs: 30_000,
};
const serverId = 'example';

const supervisor = new MCPConnectionSupervisor({
  serverId,
  openSession: (signal) =>
    openMcpSession({
      serverId,
      transport: adapter.construct(admission.admitted),
      timeouts,
      signal,
    }),
  timeouts,
});

const discovery = await supervisor.discover();
const catalog = buildCatalog([
  { serverId, origin: 'config:example', transport: 'streamable-http', discovery },
]);

const tools = catalog.adopted
  .filter((entry) => entry.kind === 'tool')
  .map((entry) => createDiscoveredTool(entry, supervisor));
```

The default HTTP carrier validates and pins each actual request, including authentication retries
and SSE reconnects, to addresses from the resolver captured during admission. Closing a transport
withdraws pending requests and late authentication results and releases its owned connections.
Explicit `deps.fetch` injection is an owner/test carrier with its own socket-policy responsibility.

From a repository checkout, build core and this package, then use
[`examples/verify-http-transport.mjs`](examples/verify-http-transport.mjs) to exercise initialization,
an actual persistent SSE connection and cleanup in Node or Bun against a separate disposable Node server:

```sh
pnpm --filter @robota-sdk/agent-core build
pnpm --filter @robota-sdk/agent-mcp build
node packages/agent-mcp/examples/verify-http-transport.mjs
mcp_fixture_node=$(node -p process.execPath)
bun packages/agent-mcp/examples/verify-http-transport.mjs "$mcp_fixture_node"
mcp_fixture_dir=$(mktemp -d)
bun build --compile --minify packages/agent-mcp/examples/verify-http-transport.mjs --outfile "$mcp_fixture_dir/mcp-smoke"
"$mcp_fixture_dir/mcp-smoke" "$mcp_fixture_node"
rm -rf "$mcp_fixture_dir"
```

The fixture explicitly permits its disposable local server; it does not verify a full CLI worker,
cloud provider or physical egress containment. The HTTP socket, authentication, trace and receive
limit suites cover their corresponding contracts separately.

`admit` runs the shared egress policy before any connection: plain `http:` outside loopback, private
address ranges and cloud-metadata addresses are refused, and redirects are refused rather than followed.
`openMcpSession()` identifies itself to the server as `mcp-client` unless you pass `clientInfo`.

The catalog sorts everything the server disclosed into `adopted`, `adapted` and `rejected` entries, with
stable, collision-safe tool names. The supervisor retries only transient failures, with bounded backoff,
and keeps a catalog marked stale rather than emptying it when a refresh fails.

### stdio

Stdio needs a host-owned `IMCPStdioAuthority`: an allowed root directory, an absolute executable, exact
argument vectors, an explicitly selected child environment, and a generation. Pass a resolved definition
and its activation request to `createStdioAdapter({ admission, authority }).admit(...)` before opening a
session; the adapter rechecks activation and authority before every spawn. The child inherits no ambient
environment values: the SDK's default environment keys are present only with host-selected values or
empty strings. Cancelling or timing out an active stdio request closes the direct child, because the
SDK provides no cancellation acknowledgment; grandchild processes are outside this transport's
guarantee. See the runnable [`--allowed` / `--denied` example](examples/verify-stdio-transport.ts).

### Authentication

A host registers an authenticator for one server identity, and the HTTP transport asks it for headers on
every request to that server only. The package provides:

- OAuth sign-in for servers that declare `oauth`: `runMCPOAuthLogin`, `runMCPOAuthLogout`,
  `createOAuthAuthenticator`, with storage (`createFileOAuthCredentialStore`) and a cross-process refresh
  lock (`createFileOAuthRefreshLock`) as replaceable ports.
- A headers helper (`createHeadersHelperAuthenticator`): an exact argv the host allows and runs, whose
  output is parsed strictly into request headers.

A definition that asks for authentication the host cannot provide stays listed and is refused by name;
it is never connected with its static headers alone.

## Where it sits

Depends only on `@robota-sdk/agent-core` (peer) and `@modelcontextprotocol/sdk`. It owns no tool
registry and no product identity: the composition root (for example the CLI) chooses the client identity
and wires the discovered tools in.

## Documentation

- [docs/SPEC.md](docs/SPEC.md) — the full contract: admission, precedence, secrecy, OAuth, stdio
  authority and supervision.
- [docs/README.md](docs/README.md) — documentation index.
