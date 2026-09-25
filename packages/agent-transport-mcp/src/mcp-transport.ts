/**
 * ITransportAdapter implementation for MCP transport.
 *
 * Connects the official SDK stdio carrier to the canonical session MCP server.
 * The adapter owns carrier readiness and teardown; the product shell owns process policy.
 */

import { PassThrough } from 'node:stream';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createAgentMcpServer } from './mcp-server.js';

import type { IMcpTransportSession } from './mcp-session.js';
import type { IMcpSubmitToolIdentity } from './mcp-tool-surface.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type {
  ITransportAdapter,
  ITransportLifecycleError,
} from '@robota-sdk/agent-interface-transport';
import type { Readable, Writable } from 'node:stream';

const STARTUP_TIMEOUT_MS = 15000;

export interface IMcpTransportOptions {
  /** Name for the MCP server. */
  name: string;
  /** Version string. */
  version: string;
  /** Process-owned streams; defaults to the current process stdio. */
  stdin?: Readable;
  stdout?: Writable;
  /** Host-owned identity for the submission extension. */
  submitTool?: IMcpSubmitToolIdentity;
}

export interface IMcpTransport extends ITransportAdapter<IMcpTransportSession> {
  getServer(): Server;
  /** Settles when the carrier closes or its input ends; rejects on carrier failure. */
  waitForClose(): Promise<void>;
}

export function createMcpTransport(options: IMcpTransportOptions): IMcpTransport {
  let session: IMcpTransportSession | null = null;
  let server: Server | null = null;
  let starting: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;
  let inputBridge: PassThrough | null = null;
  let cancelStart: ((error: Error) => void) | null = null;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  let resolveClose: (() => void) | null = null;
  let rejectClose: ((error: Error) => void) | null = null;
  let closePromise: Promise<void> = Promise.resolve();
  const resetClose = (): void => {
    closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    // A carrier may fail between connect and the process owner awaiting this promise.
    // allow-fallback: waitForClose retains the rejection for the process owner; this observer only prevents an early unhandled-rejection warning.
    void closePromise.catch(() => undefined);
  };
  const onInputClose = (): void => {
    resolveClose?.();
    cancelStart?.(new Error('MCP input closed during startup'));
  };
  const onOutputClose = (): void => {
    resolveClose?.();
    cancelStart?.(new Error('MCP output closed during startup'));
  };
  const onOutputError = (error: Error): void => {
    rejectClose?.(error);
    cancelStart?.(error);
  };
  const removeInputListeners = (): void => {
    stdin.off('end', onInputClose);
    stdin.off('close', onInputClose);
    stdout.off('close', onOutputClose);
    stdout.off('error', onOutputError);
    if (inputBridge) {
      stdin.unpipe(inputBridge);
      inputBridge.destroy();
      inputBridge = null;
    }
  };
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
      if (server || starting || stopping) throw lifecycleError('already-started');
      session = s;
      resetClose();
    },
    async start() {
      if (!session) throw lifecycleError('not-attached');
      if (server || starting || stopping) throw lifecycleError('already-started');
      const attachedSession = session;
      const cancelled = new Promise<never>((_resolve, reject) => {
        cancelStart = reject;
      });
      const bridge = new PassThrough();
      inputBridge = bridge;
      stdin.once('end', onInputClose);
      stdin.once('close', onInputClose);
      stdout.once('close', onOutputClose);
      stdout.on('error', onOutputError);
      // Preserve early frames with backpressure while the canonical tool catalog is validated.
      // Piping also exposes EOF before the SDK begins reading.
      stdin.pipe(bridge);
      starting = (async () => {
        let candidate: Server | null = null;
        const timeout = setTimeout(
          () => cancelStart?.(new Error('MCP carrier startup timed out')),
          STARTUP_TIMEOUT_MS,
        );
        try {
          candidate = await Promise.race([
            createAgentMcpServer({
              name: options.name,
              version: options.version,
              session: attachedSession,
              ...(options.submitTool !== undefined ? { submitTool: options.submitTool } : {}),
            }),
            cancelled,
          ]);
          const nextCarrier = new StdioServerTransport(bridge, stdout);
          nextCarrier.onclose = () => resolveClose?.();
          nextCarrier.onerror = (error) => rejectClose?.(error);
          await candidate.connect(nextCarrier);
          server = candidate;
          candidate = null;
        } catch (error) {
          removeInputListeners();
          // allow-fallback: the startup error is already being thrown; a failed best-effort close must not replace it.
          if (candidate) await candidate.close().catch(() => undefined);
          throw error;
        } finally {
          clearTimeout(timeout);
          cancelStart = null;
        }
      })();
      try {
        await starting;
      } finally {
        starting = null;
      }
    },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        try {
          cancelStart?.(new Error('MCP carrier startup stopped'));
          // allow-fallback: stop explicitly cancels startup, so its expected rejection is consumed before carrier teardown.
          if (starting) await starting.catch(() => undefined);
          if (server) await server.close();
        } finally {
          removeInputListeners();
          server = null;
          session = null;
          resolveClose?.();
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
    waitForClose() {
      return closePromise;
    },
  };
}
