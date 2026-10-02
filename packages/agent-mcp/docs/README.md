# @robota-sdk/agent-mcp

The Model Context Protocol client for the Robota SDK. It lets an agent use tools from external MCP
servers while keeping three concerns separate: **definitions** (decoding configuration, precedence
between sources, disable overlays, redacted projections, and the identity an approval is tied to),
**activation** (a deny-by-default admission port and a replaceable approval and audit store), and the
**client, catalog and supervision** (the official `@modelcontextprotocol/sdk` client behind an
admit-then-construct transport seam, the canonical tool/prompt/resource catalog, and the connection
lifecycle supervisor). It also provides OAuth sign-in and header-helper authentication for servers that
require them.

Transports are Streamable HTTP and host-authorized stdio. Discovered tools reach the agent through the
ordinary tool slot. Serving an agent session as an MCP server is a different package,
`@robota-sdk/agent-transport-mcp`. For configuring MCP servers in the CLI, see the
[MCP guide](../../../content/guide/mcp.md).

## Documents

- [SPEC.md](./SPEC.md) — the package contract: admission, precedence, secrecy, OAuth, stdio authority and
  supervision.
- [README](../README.md) — installation and a usage example.
