/**
 * ITransportAdapter implementation for MCP transport.
 *
 * Wraps createAgentMcpServer into the unified ITransportAdapter interface
 * while exposing the underlying MCP Server via getServer().
 */

import type { InteractiveSession, ITransportAdapter } from '@robota-sdk/agent-sdk';
import { createAgentMcpServer } from './mcp-server.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface IMcpTransportOptions {
  /** Name for the MCP server. */
  name: string;
  /** Version string. */
  version: string;
  /** If true, register each system command as a separate MCP tool. Default: true. */
  exposeCommands?: boolean;
}

export function createMcpTransport(
  options: IMcpTransportOptions,
): ITransportAdapter & { getServer(): Server } {
  let session: InteractiveSession | null = null;
  let server: Server | null = null;

  return {
    name: 'mcp',
    attach(s: InteractiveSession) {
      session = s;
    },
    async start() {
      if (!session) throw new Error('No session attached. Call attach() first.');
      server = createAgentMcpServer({ ...options, session });
    },
    async stop() {
      if (server) {
        await server.close();
        server = null;
      }
    },
    getServer() {
      if (!server) throw new Error('Transport not started. Call start() first.');
      return server;
    },
  };
}
