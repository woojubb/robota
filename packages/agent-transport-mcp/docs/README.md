# @robota-sdk/agent-transport-mcp

The MCP server transport for the Robota SDK. It serves one running agent session as a Model Context
Protocol server — its runtime tools under their canonical names, plus a prompt-submission tool — over
three carriers:

- **stdio** (`createMcpTransport`), for a client that launches the agent as a child process;
- **authenticated loopback Streamable HTTP** (`createMcpHttpHost`), bound to `127.0.0.1` and admitted by a
  bearer token minted for each host;
- **OAuth-authorized remote Streamable HTTP** (`createMcpRemoteHttpHost`), an OAuth protected resource
  that admits only access tokens its injected verifier accepts.

Token signature checks and the shared bearer gate live in `@robota-sdk/agent-transport/node`. The MCP
client side (connecting an agent to other MCP servers) is `@robota-sdk/agent-mcp`. For the task-level
walkthrough, including serving a session with the configured CLI's `mcp serve` command, see the [MCP guide](../../../content/guide/mcp.md).

## Documents

- [SPEC.md](./SPEC.md) — package contract: admission per carrier, lifecycle, catalog and error rules.
- [README](../README.md) — installation and usage for each carrier.
