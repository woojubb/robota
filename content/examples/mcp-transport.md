# MCP Transport

Expose an `InteractiveSession` as a Model Context Protocol server with
`@robota-sdk/agent-transport-mcp`, so an MCP client (a desktop assistant, an IDE, another agent) can
call the session's tools or hand it a prompt.

## Basic setup (stdio)

`createMcpTransport()` builds the MCP server and connects it to the process's stdin and stdout when
you call `start()`. Do not connect it to another carrier yourself.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { createMcpTransport } from '@robota-sdk/agent-transport-mcp';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const session = new InteractiveSession({ cwd: process.cwd(), provider });

const transport = createMcpTransport({
  name: 'my-agent',
  version: '1.0.0',
});

session.attachTransport(transport);
await transport.start(); // serves MCP over process.stdin / process.stdout

// Runs until the client disconnects
await transport.waitForClose();
await transport.stop();
await session.shutdown();
```

stdout carries the MCP protocol, so write any logging to stderr. Pass `stdin` and `stdout` options to
use other streams. An MCP client launches this script as a stdio server command.

## Tools the server offers

- **The session's runtime tools**, under their own names and input schemas — the same tools the
  session's model can call.
- **`agent_submit`**, which sends a prompt to the session and returns the response of that turn.
  Rename it with `submitTool: { name, description }`; startup fails if the name collides with a
  runtime tool.

If the session composes model-invocable commands, they appear among the runtime tools as
`command_<name>` (set `modelCommandToolPrefix` on the session to change the prefix). Resources and
prompts are not offered.

Tool calls go through the session's permission checks, but an MCP client cannot answer a permission
prompt: a call that would ask comes back as a tool error. Give the session the `permissionMode` (and
`allowedTools`) its MCP clients need.

## Advanced: direct MCP server

`createAgentMcpServer()` returns the MCP SDK `Server` without connecting it, for when you manage the
carrier yourself:

```typescript
import { createAgentMcpServer } from '@robota-sdk/agent-transport-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { IMcpTransportSession } from '@robota-sdk/agent-transport-mcp';

declare const session: IMcpTransportSession; // for example an InteractiveSession

const server = await createAgentMcpServer({
  name: 'my-agent',
  version: '1.0.0',
  session,
});

await server.connect(new StdioServerTransport());
```

For a loopback HTTP endpoint with a bearer token, or a remote endpoint behind OAuth, the package also
exports `createMcpHttpHost()` and `createMcpRemoteHttpHost()`; see the
[package README](../../packages/agent-transport-mcp/README.md).

## From the CLI

`__PRODUCT_CLI_NAME__ mcp serve` does the same for the CLI's own session, over stdio by default. It names the
submit tool `__PRODUCT_MODEL_TOOL_PREFIX___submit` and command tools `__PRODUCT_MODEL_TOOL_PREFIX___command_<name>`. `__PRODUCT_CLI_NAME__ --help` lists its
HTTP options (`--http-token-file`, `--http-public-url` and the `--oauth-*` flags).
