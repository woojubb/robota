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
ordinary tool slot, so there is no MCP-specific runtime path. The Robota CLI uses this package for its
`mcpServers` configuration; see the [MCP guide](../../content/guide/mcp.md) for that side. To expose a
Robota session _as_ an MCP server, use
[`@robota-sdk/agent-transport-mcp`](../agent-transport-mcp/README.md).

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
