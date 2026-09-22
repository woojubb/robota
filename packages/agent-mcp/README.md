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
transport set of this unit is Streamable HTTP only (TC-06); a stdio adapter ships in MCP-2522.

See [`docs/SPEC.md`](docs/SPEC.md) for the package contract.

## Usage

Admit a transport, open a session inside a connection supervisor, discover the server, build the
catalog, and expose a discovered tool to the runtime:

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
