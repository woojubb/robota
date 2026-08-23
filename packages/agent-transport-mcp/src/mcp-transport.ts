/**
 * ITransportAdapter implementation for MCP transport.
 *
 * Wraps createAgentMcpServer into the unified ITransportAdapter interface
 * while exposing the underlying MCP Server via getServer().
 */

import { createAgentMcpServer } from './mcp-server.js';

import type { IMcpTransportSession } from './mcp-session.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportAdapter,
  ITransportLifecycleError,
} from '@robota-sdk/agent-interface-transport';

export interface IMcpTransportOptions {
  /** Name for the MCP server. */
  name: string;
  /** Version string. */
  version: string;
  /** If true, register each system command as a separate MCP tool. Default: true. */
  exposeCommands?: boolean;
}

export interface IMcpTransport extends ITransportAdapter<IInteractiveSession> {
  attach(session: IMcpTransportSession): void;
  getServer(): Server;
}

export function createMcpTransport(options: IMcpTransportOptions): IMcpTransport {
  let session: IMcpTransportSession | null = null;
  let server: Server | null = null;
  const lifecycleError = (code: ITransportLifecycleError['code']): ITransportLifecycleError =>
    Object.assign(new Error(`MCP transport ${code}.`), {
      name: 'TransportLifecycleError' as const,
      code,
      transportName: 'mcp',
    });

  return {
    name: 'mcp',
    lifecycle: Object.freeze({ kind: 'service' }),
    attach(s: IMcpTransportSession) {
      session = s;
    },
    async start() {
      if (!session) throw lifecycleError('not-attached');
      if (server) throw lifecycleError('already-started');
      server = createAgentMcpServer({ ...options, session });
    },
    async stop() {
      if (server) {
        await server.close();
        server = null;
      }
      session = null;
    },
    getServer() {
      if (!server) throw new Error('Transport not started. Call start() first.');
      return server;
    },
  };
}
