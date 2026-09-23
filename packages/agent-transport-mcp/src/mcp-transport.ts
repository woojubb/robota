/**
 * ITransportAdapter implementation for MCP transport.
 *
 * Wraps createAgentMcpServer into the unified ITransportAdapter interface
 * while exposing the underlying MCP Server via getServer().
 */

import { createAgentMcpServer } from './mcp-server.js';

import type { IMcpTransportSession } from './mcp-session.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type {
  ITransportAdapter,
  ITransportLifecycleError,
} from '@robota-sdk/agent-interface-transport';

export interface IMcpTransportOptions {
  /** Name for the MCP server. */
  name: string;
  /** Version string. */
  version: string;
}

export interface IMcpTransport extends ITransportAdapter<IMcpTransportSession> {
  getServer(): Server;
}

export function createMcpTransport(options: IMcpTransportOptions): IMcpTransport {
  let session: IMcpTransportSession | null = null;
  let server: Server | null = null;
  let starting: Promise<Server> | null = null;
  let stopping: Promise<void> | null = null;
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
      if (server || starting || stopping) throw lifecycleError('already-started');
      starting = createAgentMcpServer({ ...options, session });
      try {
        server = await starting;
      } finally {
        starting = null;
      }
    },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        try {
          if (starting) await starting;
          if (server) await server.close();
        } finally {
          server = null;
          session = null;
        }
      })().finally(() => {
        stopping = null;
      });
      return stopping;
    },
    getServer() {
      if (!server) throw new Error('Transport not started. Call start() first.');
      return server;
    },
  };
}
