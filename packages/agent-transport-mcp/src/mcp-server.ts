/** MCP translates the canonical session tool port; execution policy stays in the session. */
import { Server } from '@modelcontextprotocol/server';

import { invokeMcpTool, readCatalog, resolveSubmitTool } from './mcp-tool-surface.js';

import type { IMcpTransportSession } from './mcp-session.js';
import type { IMcpSubmitToolIdentity } from './mcp-tool-surface.js';
import type { Tool } from '@modelcontextprotocol/server';

export interface IAgentMcpOptions {
  name: string;
  version: string;
  session: IMcpTransportSession;
  /** Host-owned identity for the submission extension. */
  submitTool?: IMcpSubmitToolIdentity;
}

/**
 * One server instance over the canonical catalog, for a caller that has already validated the
 * catalog and owns the carrier: the stdio transport connects one for its connection, the HTTP
 * hosts build one per request. Both carriers answer from the same two handlers.
 */
export function buildAgentMcpServer(
  options: Omit<IAgentMcpOptions, 'submitTool'>,
  submitTool: Tool,
): Server {
  const { name, version, session } = options;
  const server = new Server({ name, version }, { capabilities: { tools: {} } });
  server.setRequestHandler('tools/list', async () => ({
    tools: [...(await readCatalog(session, submitTool.name)), submitTool],
  }));
  server.setRequestHandler('tools/call', async (request, ctx) =>
    invokeMcpTool(
      session,
      request.params.name,
      request.params.arguments ?? {},
      ctx.mcpReq.signal,
      submitTool.name,
    ),
  );
  return server;
}

/** Validate the catalog before the caller connects a carrier. */
export async function createAgentMcpServer(options: IAgentMcpOptions): Promise<Server> {
  const submitTool = resolveSubmitTool(options.submitTool);
  await readCatalog(options.session, submitTool.name);
  return buildAgentMcpServer(options, submitTool);
}
