/**
 * One initialized MCP protocol session over an admitted transport (MCP-002).
 *
 * Ownership (spec § Decision, connection-state allocation): a session owns the NEGOTIATED FACTS of
 * one protocol session — `protocolVersion`, `serverInfo`, `instructions`, capabilities, the SDK
 * `Client` handle — and is STATELESS ABOUT LIVENESS. Open / reuse / close, retry state and the single
 * connection-state union belong to `../supervisor/connection.ts`.
 *
 * Contract file: the interfaces below are authoritative for every consumer; the implementation is
 * completed against them (TC-01, TC-19 per-request timeout, TC-17 close).
 */

import { openStatelessSession } from './stateless-session.js';
import {
  buildDeclaredCapabilities,
  createMcpClient,
  DEFAULT_CLIENT_INFO,
  isRequestTimeout,
  MCPSessionError,
  STATELESS_PROTOCOL_VERSION,
  toToolCallResult,
} from './session-protocol.js';
export { MCPSessionError } from './session-protocol.js';

import { MCPAuthenticationError } from './authentication.js';
import { MCPTransportEgressRefusedError } from './pinned-http-fetch.js';
import { discoverAll } from './discovery.js';
import { createElicitationHandler, MCPElicitationCalls } from './elicitation.js';
import { MCPStdioError } from './stdio-transport.js';
import { callTraceRegistryOf, runInCallTraceScope } from './trace-propagation.js';
import { MCPDiscoveryError } from '../catalog/types.js';

import type { IMCPDiscovery, IMCPServerIdentity } from '../catalog/types.js';
import type { IUniversalObjectValue, TToolParameters } from '@robota-sdk/agent-core';
import type { Client, Implementation, Tool, Transport } from '@modelcontextprotocol/client';
import type {
  IMCPDiscoverOptions,
  IMCPOpenSessionOptions,
  IMCPSession,
  IMCPToolCallOptions,
  IMCPToolCallResult,
  TMCPListChangedListener,
} from './session-types.js';
export type {
  IMCPDiscoverOptions,
  IMCPOpenSessionOptions,
  IMCPSession,
  IMCPSessionTimeouts,
  IMCPToolCallOptions,
  IMCPToolCallResult,
  TMCPListChangedListener,
} from './session-types.js';

/** Versions accepted by default legacy negotiation; stateless opt-in never expands this set. */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
]);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sensitiveTransport(transport: Transport): boolean {
  return 'sensitiveDiagnostics' in transport && transport.sensitiveDiagnostics === true;
}

function startupBudget(options: IMCPOpenSessionOptions): number {
  const transport = options.transport;
  if ('stdioStartupMs' in transport && typeof transport.stdioStartupMs === 'number') {
    return Math.min(options.timeouts.startupMs, transport.stdioStartupMs);
  }
  return options.timeouts.startupMs;
}

/** The SDK reports an aborted request as a timeout too; an abort the caller asked for is not one. */
function isStartupTimeout(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    (isRequestTimeout(error) && signal?.aborted !== true) ||
    (error instanceof MCPSessionError && error.kind === 'startup-timeout')
  );
}

/** Runs `initialize` within `startupMs`, retaining a typed stdio authority refusal after cleanup. */
async function connectClient(client: Client, options: IMCPOpenSessionOptions): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    if (sensitiveTransport(options.transport) && options.signal?.aborted) {
      throw new MCPSessionError('initialize-failed', 'Stdio session startup cancelled');
    }
    const effectiveStartupMs = startupBudget(options);
    const connection = client.connect(options.transport, {
      timeout: effectiveStartupMs,
      signal: options.signal,
    });
    if (sensitiveTransport(options.transport)) {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new MCPSessionError('startup-timeout', 'Stdio session startup timed out')),
          effectiveStartupMs,
        );
        abort = () =>
          reject(new MCPSessionError('initialize-failed', 'Stdio session startup cancelled'));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
      await Promise.race([connection, deadline]);
    } else {
      await connection;
    }
  } catch (error) {
    if (sensitiveTransport(options.transport)) {
      try {
        await options.transport.close();
      } catch {
        throw new MCPStdioError('cleanup');
      }
      if (error instanceof MCPStdioError && error.reason === 'authority') throw error;
      const timedOut = isStartupTimeout(error, options.signal);
      throw new MCPSessionError(
        timedOut ? 'startup-timeout' : 'initialize-failed',
        timedOut ? 'Stdio session startup timed out' : 'Stdio session startup failed',
      );
    }
    await client.close();
    // A refused credential stays typed, so the supervisor classifies it `auth` and does not retry
    // what the server will refuse again.
    if (error instanceof MCPAuthenticationError) throw error;
    if (error instanceof MCPTransportEgressRefusedError) throw error;
    if (isStartupTimeout(error, options.signal)) {
      throw new MCPSessionError(
        'startup-timeout',
        `MCP session startup exceeded ${options.timeouts.startupMs}ms`,
        { cause: describeError(error) },
      );
    }
    throw new MCPSessionError('initialize-failed', describeError(error), {
      cause: describeError(error),
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) options.signal?.removeEventListener('abort', abort);
  }
}

/** Verifies the negotiated protocol version is supported; closes and throws otherwise. */
async function requireNegotiatedVersion(client: Client, transport: Transport): Promise<string> {
  const negotiatedVersion = client.getNegotiatedProtocolVersion();
  if (negotiatedVersion === undefined || !SUPPORTED_MCP_PROTOCOL_VERSIONS.has(negotiatedVersion)) {
    await client.close();
    throw new MCPSessionError(
      'unsupported-protocol-version',
      sensitiveTransport(transport)
        ? 'Stdio server negotiated an unsupported MCP protocol version'
        : `Server negotiated unsupported MCP protocol version "${negotiatedVersion ?? 'unknown'}"`,
      sensitiveTransport(transport) ? undefined : { protocolVersion: negotiatedVersion },
    );
  }
  return negotiatedVersion;
}

/** Verifies the server reported `serverInfo` at initialize; closes and throws otherwise. */
async function requireServerVersion(client: Client): Promise<Implementation> {
  const serverVersion = client.getServerVersion();
  if (serverVersion === undefined) {
    await client.close();
    throw new MCPSessionError(
      'initialize-failed',
      'Server did not report serverInfo after initialize',
    );
  }
  return serverVersion;
}

function registerListChangedHandlers(
  client: Client,
  listeners: ReadonlySet<TMCPListChangedListener>,
): void {
  client.setNotificationHandler('notifications/tools/list_changed', () => {
    listeners.forEach((listener) => listener('tools'));
  });
  client.setNotificationHandler('notifications/prompts/list_changed', () => {
    listeners.forEach((listener) => listener('prompts'));
  });
  client.setNotificationHandler('notifications/resources/list_changed', () => {
    listeners.forEach((listener) => listener('resources'));
  });
}

/**
 * Connect the SDK `Client`, run `initialize` + `notifications/initialized` within `startupMs`, verify
 * the negotiated protocol version is supported (else close and throw `unsupported-protocol-version`),
 * and return the session. The explicitly selected modern revision is served by the same client,
 * pinned (`./stateless-session.ts`). Implemented in this file against the interfaces above.
 */
export async function openMcpSession(options: IMCPOpenSessionOptions): Promise<IMCPSession> {
  if (options.skills && options.protocolVersion !== STATELESS_PROTOCOL_VERSION)
    throw new MCPSessionError(
      'unsupported-protocol-version',
      'Skills require explicit stateless protocol selection',
    );
  if (options.protocolVersion === STATELESS_PROTOCOL_VERSION) return openStatelessSession(options);
  if (options.protocolVersion !== undefined)
    throw new MCPSessionError(
      'unsupported-protocol-version',
      'Unsupported explicitly selected MCP protocol version',
    );
  const calls = new MCPElicitationCalls();
  const client = createMcpClient(
    options.clientInfo ?? DEFAULT_CLIENT_INFO,
    undefined,
    options.elicitation === true
      ? createElicitationHandler({ serverId: () => options.serverId, calls })
      : undefined,
  );

  await connectClient(client, options);

  const negotiatedVersion = await requireNegotiatedVersion(client, options.transport);
  const serverVersion = await requireServerVersion(client);

  const identity: IMCPServerIdentity = {
    serverId: options.serverId,
    serverName: serverVersion.name,
    serverVersion: serverVersion.version,
    protocolVersion: negotiatedVersion,
  };
  const instructions = client.getInstructions();
  const declaredCapabilities = buildDeclaredCapabilities(client.getServerCapabilities());

  const callTraces = callTraceRegistryOf(options.transport);
  const listeners = new Set<TMCPListChangedListener>();
  registerListChangedHandlers(client, listeners);
  /**
   * The output schemas the latest discovery declared. The SDK validates `structuredContent` against
   * the schema it is handed; its own source is the aggregating `listTools` cache, which per-page
   * discovery never fills, so the declared schema travels with each call instead.
   */
  let outputSchemas: ReadonlyMap<string, IUniversalObjectValue> = new Map();

  let closePromise: Promise<void> | undefined;
  const closeSession = (): Promise<void> => {
    closePromise ??= client.close();
    return closePromise;
  };
  const throwIfStdioChildExited = async (): Promise<void> => {
    if (!('closedDirectChild' in options.transport) || options.transport.closedDirectChild !== true)
      return;
    try {
      await closeSession();
    } catch {
      throw new MCPStdioError('cleanup');
    }
    throw new MCPStdioError('early-exit');
  };

  return {
    identity,
    instructions,
    declaredCapabilities,
    async discover(discoverOptions: IMCPDiscoverOptions): Promise<IMCPDiscovery> {
      try {
        const discovery = await discoverAll(
          client,
          declaredCapabilities,
          identity,
          instructions,
          discoverOptions,
        );
        outputSchemas = new Map(
          discovery.tools.items.flatMap((tool) =>
            tool.outputSchema === undefined ? [] : [[tool.name, tool.outputSchema] as const],
          ),
        );
        return discovery;
      } catch (error) {
        if (sensitiveTransport(options.transport)) {
          if (
            discoverOptions.signal?.aborted ||
            (error instanceof MCPDiscoveryError && error.failure.kind === 'timeout')
          ) {
            await closeSession();
            throw new MCPStdioError('cancelled');
          }
          await throwIfStdioChildExited();
          throw new MCPStdioError('send');
        }
        throw error;
      }
    },
    async callTool(
      name: string,
      args: TToolParameters,
      callOptions?: IMCPToolCallOptions,
    ): Promise<IMCPToolCallResult> {
      const outputSchema = outputSchemas.get(name);
      const call = () =>
        client.callTool(
          { name, arguments: args },
          {
            timeout: callOptions?.timeoutMs,
            signal: callOptions?.signal,
            ...(outputSchema === undefined
              ? {}
              : {
                  toolDefinition: {
                    name,
                    inputSchema: { type: 'object' },
                    outputSchema: outputSchema as unknown as NonNullable<Tool['outputSchema']>,
                  },
                }),
          },
        );
      const outboundTraceContext = callOptions?.outboundTraceContext;
      const traceScope =
        callTraces !== undefined
          ? {
              requestAbortController: new AbortController(),
              ...(outboundTraceContext ? { outbound: outboundTraceContext } : {}),
            }
          : undefined;
      const leave = calls.enter({ ask: callOptions?.ask, signal: callOptions?.signal });
      try {
        const raw = traceScope ? await runInCallTraceScope(traceScope, call) : await call();
        return toToolCallResult(raw);
      } catch (error) {
        if (sensitiveTransport(options.transport)) {
          if (callOptions?.signal?.aborted || isRequestTimeout(error)) {
            await closeSession();
            throw new MCPStdioError('cancelled');
          }
          await throwIfStdioChildExited();
          throw new MCPStdioError('send');
        }
        throw error;
      } finally {
        leave();
        if (traceScope) callTraces?.release(traceScope);
      }
    },
    onListChanged(listener: TMCPListChangedListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      await closeSession();
    },
  };
}
