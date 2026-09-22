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
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TypeUtils } from '@robota-sdk/agent-core';

import { discoverAll } from './discovery.js';
import { toUniversalObject } from '../catalog/universal-value.js';

import type { IMCPDiscovery, IMCPServerIdentity, TMCPCapabilityDomain } from '../catalog/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Implementation, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type { IUniversalObjectValue, TToolParameters } from '@robota-sdk/agent-core';

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

export interface IMCPToolCallResult {
  readonly content: readonly IUniversalObjectValue[];
  readonly structuredContent?: IUniversalObjectValue;
  readonly isError: boolean;
}

/** Fired by the SDK when a server announces `notifications/<domain>/list_changed`. */
export type TMCPListChangedListener = (domain: TMCPCapabilityDomain) => void;

export interface IMCPSession {
  readonly identity: IMCPServerIdentity;
  readonly instructions?: string;
  /** Capability keys the server declared at initialize; absence means the domain is never called. */
  readonly declaredCapabilities: Readonly<
    Record<TMCPCapabilityDomain, { listChanged: boolean } | undefined>
  >;
  /** Paginated discovery over every declared domain; bounded and typed (`../catalog/types.js`). */
  discover(options: IMCPDiscoverOptions): Promise<IMCPDiscovery>;
  callTool(
    name: string,
    args: TToolParameters,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<IMCPToolCallResult>;
  /** Subscribe to `list_changed`; returns an unsubscribe. */
  onListChanged(listener: TMCPListChangedListener): () => void;
  /** Closes the SDK client and its transport. Idempotent. */
  close(): Promise<void>;
}

export interface IMCPDiscoverOptions {
  /** Hard bound on list pages per domain; exceeding it is a named `page-bound-exceeded` failure. */
  readonly maxPages: number;
  readonly perRequestTimeoutMs: number;
  readonly signal?: AbortSignal;
}

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

const DEFAULT_CLIENT_INFO = { name: 'robota-agent-mcp', version: '0.0.0' } as const;

/** Feature-detects the negotiated protocol version the SDK stamped onto the transport at connect(). */
function readNegotiatedProtocolVersion(transport: Transport): string | undefined {
  const candidate = transport as Transport & { readonly protocolVersion?: unknown };
  return typeof candidate.protocolVersion === 'string' ? candidate.protocolVersion : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRequestTimeout(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
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

/** Runs `initialize` within `startupMs`, mapping a failure to the two named `MCPSessionError` kinds. */
async function connectClient(client: Client, options: IMCPOpenSessionOptions): Promise<void> {
  try {
    await client.connect(options.transport, {
      timeout: options.timeouts.startupMs,
      signal: options.signal,
    });
  } catch (error) {
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
  }
}

/** Verifies the negotiated protocol version is supported; closes and throws otherwise. */
async function requireNegotiatedVersion(client: Client, transport: Transport): Promise<string> {
  const negotiatedVersion = readNegotiatedProtocolVersion(transport);
  if (negotiatedVersion === undefined || !SUPPORTED_MCP_PROTOCOL_VERSIONS.has(negotiatedVersion)) {
    await client.close();
    throw new MCPSessionError(
      'unsupported-protocol-version',
      `Server negotiated unsupported MCP protocol version "${negotiatedVersion ?? 'unknown'}"`,
      { protocolVersion: negotiatedVersion },
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

  const listeners = new Set<TMCPListChangedListener>();
  registerListChangedHandlers(client, listeners);

  let closed = false;

  return {
    identity,
    instructions,
    declaredCapabilities,
    async discover(discoverOptions: IMCPDiscoverOptions): Promise<IMCPDiscovery> {
      return discoverAll(client, declaredCapabilities, identity, instructions, discoverOptions);
    },
    async callTool(
      name: string,
      args: TToolParameters,
      callOptions?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
    ): Promise<IMCPToolCallResult> {
      const raw = await client.callTool({ name, arguments: args }, undefined, {
        timeout: callOptions?.timeoutMs,
        signal: callOptions?.signal,
      });
      return toToolCallResult(raw);
    },
    onListChanged(listener: TMCPListChangedListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}
