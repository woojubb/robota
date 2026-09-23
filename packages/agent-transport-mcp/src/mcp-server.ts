/** MCP translates the canonical session tool port; execution policy stays in the session. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { invokeMcpTool, readCatalog, SUBMIT_TOOL } from './mcp-tool-surface.js';

import type { IMcpTransportSession } from './mcp-session.js';

export interface IAgentMcpOptions {
  name: string;
  version: string;
  session: IMcpTransportSession;
}

/** Validate the catalog before the caller connects a carrier. */
export async function createAgentMcpServer(options: IAgentMcpOptions): Promise<Server> {
  const { name, version, session } = options;
  await readCatalog(session);
  const server = new Server({ name, version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...(await readCatalog(session)), SUBMIT_TOOL],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    invokeMcpTool(session, request.params.name, request.params.arguments ?? {}, extra.signal),
  );
  return server;
}
