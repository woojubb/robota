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

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ErrorCode,
  McpError,
  NotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TypeUtils } from '@robota-sdk/agent-core';
import { z } from 'zod/v4';

import { MCPAuthenticationError } from './authentication.js';
import { discoverAll } from './discovery.js';
import { MCPStdioError } from './stdio-transport.js';
import { callTraceRegistryOf, runInCallTraceScope } from './trace-propagation.js';
import { MCPDiscoveryError } from '../catalog/types.js';
import { toUniversalObject } from '../catalog/universal-value.js';

import type { IMCPDiscovery, IMCPServerIdentity, TMCPCapabilityDomain } from '../catalog/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Implementation, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type {
  IOutboundTraceContext,
  IUniversalObjectValue,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { IMCPDiscoverOptions } from './session-types.js';

/** Protocol versions this legacy-era client accepts. A server answering outside the set is closed, not used. */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
]);

export interface IMCPSessionTimeouts {
  /** Budget for `initialize` + `notifications/initialized`. */
  readonly startupMs: number;
  /** Budget for each list / call request. */
  readonly perCallMs: number;
}

export interface IMCPToolCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /**
   * The calling tool body's trusted trace context. Sent as `traceparent` only on this call's own
   * `tools/call` request and its cancellation, only over HTTP, and only to an exactly listed origin.
   */
  readonly outboundTraceContext?: IOutboundTraceContext;
}

export interface IMCPToolCallResult {
  readonly content: readonly IUniversalObjectValue[];
  readonly structuredContent?: IUniversalObjectValue;
  readonly isError: boolean;
}

/** Fired by the SDK when a server announces `notifications/<domain>/list_changed`. */
export type TMCPListChangedListener = (domain: TMCPCapabilityDomain) => void;

/** Experimental, one-way MCP server event protocol. A declaration alone never grants turn admission. */
export const MCP_EXTERNAL_EVENT_CAPABILITY = 'com.robota.external-event';
export const MCP_EXTERNAL_EVENT_METHOD = 'notifications/com.robota/external-event';

const externalEventIdentity = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => {
    for (const character of value) {
      const code = character.codePointAt(0)!;
      if (code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff)) return false;
    }
    return true;
  });
const ExternalEventNotificationSchema = NotificationSchema.extend({
  method: z.literal(MCP_EXTERNAL_EVENT_METHOD),
  params: z.object({
    senderId: externalEventIdentity,
    conversationId: externalEventIdentity,
    content: z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= 16 * 1024),
  }),
});

export interface IMCPExternalEvent {
  readonly senderId: string;
  readonly conversationId: string;
  readonly content: string;
}

export type TMCPExternalEventListener = (event: IMCPExternalEvent) => void;

export interface IMCPSession {
  readonly identity: IMCPServerIdentity;
  readonly instructions?: string;
  /** Capability keys the server declared at initialize; absence means the domain is never called. */
  readonly declaredCapabilities: Readonly<
    Record<TMCPCapabilityDomain, { listChanged: boolean } | undefined>
  >;
  /** A server-declared protocol fact, not authorization to inject a session turn. */
  readonly externalEventsDeclared: boolean;
  /** Paginated discovery over every declared domain; bounded and typed (`../catalog/types.js`). */
  discover(options: IMCPDiscoverOptions): Promise<IMCPDiscovery>;
  callTool(
    name: string,
    args: TToolParameters,
    options?: IMCPToolCallOptions,
  ): Promise<IMCPToolCallResult>;
  /** Subscribe to `list_changed`; returns an unsubscribe. */
  onListChanged(listener: TMCPListChangedListener): () => void;
  /** Delivery is gated by the exact experimental capability and a live subscription. */
  onExternalEvent(listener: TMCPExternalEventListener): () => void;
  /** Fired once when the SDK client or its transport closes, including unexpected closure. */
  onClose(listener: () => void): () => void;
  /** Closes the SDK client and its transport. Idempotent. */
  close(): Promise<void>;
}

export type { IMCPDiscoverOptions } from './session-types.js';

export interface IMCPOpenSessionOptions {
  readonly serverId: string;
  /** An already-ADMITTED transport (`./transport.ts`); this function never admits anything. */
  readonly transport: Transport;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly timeouts: IMCPSessionTimeouts;
  readonly signal?: AbortSignal;
}

export class MCPSessionError extends Error {
  constructor(
    readonly kind: 'unsupported-protocol-version' | 'initialize-failed' | 'startup-timeout',
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'MCPSessionError';
  }
}

const DEFAULT_CLIENT_INFO = { name: 'mcp-client', version: '0.0.0' } as const;

/** Feature-detects the negotiated protocol version the SDK stamped onto the transport at connect(). */
function readNegotiatedProtocolVersion(transport: Transport): string | undefined {
  const candidate = transport as Transport & { readonly protocolVersion?: unknown };
  return typeof candidate.protocolVersion === 'string' ? candidate.protocolVersion : undefined;
}

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

function isRequestTimeout(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

function isStartupTimeout(error: unknown): boolean {
  return (
    isRequestTimeout(error) ||
    (error instanceof MCPSessionError && error.kind === 'startup-timeout')
  );
}

/**
 * The SDK's `callTool` return type is a union with a legacy `toolResult`-only compatibility shape
 * (no `content`/`isError`); converting the whole thing through `toUniversalObject` once, here, is
 * the boundary into the fields this session promises — every field read below is `TUniversalValue`,
 * never `unknown`.
 */
function toToolCallResult(raw: unknown): IMCPToolCallResult {
  const converted = toUniversalObject(raw);
  const rawContent = converted['content'];
  const content = Array.isArray(rawContent) ? rawContent.filter(TypeUtils.isObject) : [];
  const structuredContentValue = converted['structuredContent'];
  const structuredContent = TypeUtils.isObject(structuredContentValue)
    ? structuredContentValue
    : undefined;
  const isError = typeof converted['isError'] === 'boolean' ? converted['isError'] : false;
  return { content, structuredContent, isError };
}

function buildDeclaredCapabilities(
  serverCapabilities: ServerCapabilities | undefined,
): Readonly<Record<TMCPCapabilityDomain, { listChanged: boolean } | undefined>> {
  const domains: readonly TMCPCapabilityDomain[] = ['tools', 'prompts', 'resources'];
  const record: Record<TMCPCapabilityDomain, { listChanged: boolean } | undefined> = {
    tools: undefined,
    prompts: undefined,
    resources: undefined,
  };
  for (const domain of domains) {
    const value = serverCapabilities?.[domain];
    if (value !== undefined) {
      record[domain] = { listChanged: value.listChanged ?? false };
    }
  }
  return record;
}

function supportsExternalEvents(capabilities: ServerCapabilities | undefined): boolean {
  const declared = capabilities?.experimental?.[MCP_EXTERNAL_EVENT_CAPABILITY];
  return (
    declared !== null &&
    typeof declared === 'object' &&
    Object.hasOwn(declared, 'version') &&
    (declared as { version?: unknown }).version === 1
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
      throw new MCPSessionError(
        isStartupTimeout(error) ? 'startup-timeout' : 'initialize-failed',
        isStartupTimeout(error)
          ? 'Stdio session startup timed out'
          : 'Stdio session startup failed',
      );
    }
    // A refused credential stays typed, so the supervisor classifies it `auth` and does not retry
    // what the server will refuse again.
    if (error instanceof MCPAuthenticationError) throw error;
    if (isRequestTimeout(error)) {
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
  const negotiatedVersion = readNegotiatedProtocolVersion(transport);
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
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listeners.forEach((listener) => listener('tools'));
  });
  client.setNotificationHandler(PromptListChangedNotificationSchema, () => {
    listeners.forEach((listener) => listener('prompts'));
  });
  client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
    listeners.forEach((listener) => listener('resources'));
  });
}

/**
 * Connect the SDK `Client`, run `initialize` + `notifications/initialized` within `startupMs`, verify
 * the negotiated protocol version is supported (else close and throw `unsupported-protocol-version`),
 * and return the session. Implemented in this file against the interfaces above.
 */
export async function openMcpSession(options: IMCPOpenSessionOptions): Promise<IMCPSession> {
  const client = new Client(options.clientInfo ?? DEFAULT_CLIENT_INFO, { capabilities: {} });

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
  const externalEventsDeclared = supportsExternalEvents(client.getServerCapabilities());

  const callTraces = callTraceRegistryOf(options.transport);
  const listeners = new Set<TMCPListChangedListener>();
  const externalEventListeners = new Set<TMCPExternalEventListener>();
  const closeListeners = new Set<() => void>();
  registerListChangedHandlers(client, listeners);

  let externalEventsStopped = false;
  let closed = false;
  let closingExplicitly = false;
  const stopExternalEvents = (): void => {
    externalEventsStopped = true;
    externalEventListeners.clear();
    client.removeNotificationHandler(MCP_EXTERNAL_EVENT_METHOD);
  };
  const notifyClose = (): void => {
    stopExternalEvents();
    if (!closed) {
      closed = true;
      for (const listener of closeListeners) listener();
      closeListeners.clear();
    }
  };
  const previousOnClose = client.onclose;
  client.onclose = () => {
    if (closingExplicitly) stopExternalEvents();
    else notifyClose();
    previousOnClose?.();
  };
  let closePromise: Promise<void> | undefined;
  const closeSession = (): Promise<void> => {
    if (!closePromise) {
      closingExplicitly = true;
      stopExternalEvents();
      closePromise = client.close().then(() => notifyClose());
    }
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
    externalEventsDeclared,
    async discover(discoverOptions: IMCPDiscoverOptions): Promise<IMCPDiscovery> {
      try {
        return await discoverAll(
          client,
          declaredCapabilities,
          identity,
          instructions,
          discoverOptions,
        );
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
      const call = () =>
        client.callTool({ name, arguments: args }, undefined, {
          timeout: callOptions?.timeoutMs,
          signal: callOptions?.signal,
        });
      const outboundTraceContext = callOptions?.outboundTraceContext;
      const traceScope =
        callTraces !== undefined && outboundTraceContext !== undefined
          ? { outbound: outboundTraceContext }
          : undefined;
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
        if (traceScope) callTraces?.release(traceScope);
      }
    },
    onListChanged(listener: TMCPListChangedListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onExternalEvent(listener: TMCPExternalEventListener): () => void {
      if (!externalEventsDeclared || externalEventsStopped) return () => undefined;
      externalEventListeners.add(listener);
      if (externalEventListeners.size === 1) {
        client.setNotificationHandler(ExternalEventNotificationSchema, (notification) => {
          const event = notification.params;
          externalEventListeners.forEach((subscriber) => subscriber(event));
        });
      }
      return () => {
        externalEventListeners.delete(listener);
        if (externalEventListeners.size === 0) {
          client.removeNotificationHandler(MCP_EXTERNAL_EVENT_METHOD);
        }
      };
    },
    onClose(listener: () => void): () => void {
      if (closed) {
        listener();
        return () => undefined;
      }
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      await closeSession();
    },
  };
}
