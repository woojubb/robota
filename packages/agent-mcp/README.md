# @robota-sdk/agent-mcp

The MCP (Model Context Protocol) client-side owner for Robota SDK. It owns three things that stay
deliberately separate:

- **Definitions** (MCP-001) — what an MCP server IS: decoding, environment templates, whole-entry
  precedence, disable overlays, redacted projections, activation identity.
- **Activation** (MCP-2520) — whether a definition may be used: the admission port and a
  replaceable approval/audit store.
- **Client, catalog and supervision** (MCP-002, absorbing MCP-003) — the official
  `@modelcontextprotocol/sdk` client behind an admit-then-construct transport seam, the canonical
  tools/prompts/resources catalog, and the connection/catalog lifecycle supervisor.

Published as `@robota-sdk/agent-mcp`. Renamed from `@robota-sdk/agent-tool-mcp` by MCP-001. The
transport set is Streamable HTTP and host-authorized stdio.

See [`docs/SPEC.md`](docs/SPEC.md) for the package contract.

## Usage

Admit a transport, open a session inside a connection supervisor, discover the server, build the
catalog, and expose a discovered tool to the runtime:

`openMcpSession()` identifies itself as `mcp-client` unless the host supplies `clientInfo`. Hosts
that previously relied on the implicit `robota-agent-mcp` name can pass that name explicitly.

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

See [docs/README.md](docs/README.md) and [docs/SPEC.md](docs/SPEC.md) for the full package contract.

Stdio requires a host-owned `IMCPStdioAuthority` with an allowed root, absolute executable, exact
argument vectors, explicitly selected child environment, and a generation. Pass a resolved definition
and its activation request to `createStdioAdapter({ admission, authority }).admit(...)` before opening
a session. The adapter rechecks activation and authority before every spawn. See the runnable
[`--allowed` / `--denied` example](examples/verify-stdio-transport.ts). The SDK's default environment
keys are present with host-selected values or empty strings; no ambient values are inherited. A
cancelled or timed-out active stdio request closes the direct child because the SDK provides no
cancellation acknowledgment. Termination of grandchildren is outside this transport's guarantee.
