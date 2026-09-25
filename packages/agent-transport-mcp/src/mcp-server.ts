/** MCP translates the canonical session tool port; execution policy stays in the session. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { invokeMcpTool, readCatalog, resolveSubmitTool } from './mcp-tool-surface.js';

import type { IMcpTransportSession } from './mcp-session.js';
import type { IMcpSubmitToolIdentity } from './mcp-tool-surface.js';

export interface IAgentMcpOptions {
  name: string;
  version: string;
  session: IMcpTransportSession;
  /** Host-owned identity for the submission extension. */
  submitTool?: IMcpSubmitToolIdentity;
}

/** Validate the catalog before the caller connects a carrier. */
export async function createAgentMcpServer(options: IAgentMcpOptions): Promise<Server> {
  const { name, version, session } = options;
  const submitTool = resolveSubmitTool(options.submitTool);
  await readCatalog(session, submitTool.name);
  const server = new Server({ name, version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...(await readCatalog(session, submitTool.name)), submitTool],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    invokeMcpTool(
      session,
      request.params.name,
      request.params.arguments ?? {},
      extra.signal,
      submitTool.name,
    ),
  );
  return server;
}
