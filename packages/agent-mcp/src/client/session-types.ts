/** Shared session contracts; both protocol implementations depend on this leaf module. */
import type { IMCPSkillsSession } from '../skills/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  IOutboundTraceContext,
  IUniversalObjectValue,
  TUniversalValue,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type {
  IMCPDiscovery,
  IMCPResponseCacheHint,
  IMCPServerIdentity,
  TMCPCapabilityDomain,
} from '../catalog/types.js';

export interface IMCPDiscoverOptions {
  /** Hard bound on list pages per domain; exceeding it is a named `page-bound-exceeded` failure. */
  readonly maxPages: number;
  readonly perRequestTimeoutMs: number;
  readonly signal?: AbortSignal;
}

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
  readonly structuredContent?: TUniversalValue;
  readonly isError: boolean;
}

/** Fired by the SDK when a server announces `notifications/<domain>/list_changed`. */
export type TMCPListChangedListener = (domain: TMCPCapabilityDomain) => void;

export interface IMCPSession {
  readonly skills?: IMCPSkillsSession;
  readonly identity: IMCPServerIdentity;
  readonly discoveryCacheHint?: IMCPResponseCacheHint;
  readonly compatibilityDiagnostics?: readonly {
    readonly capability: string;
    readonly reason: string;
  }[];
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
    options?: IMCPToolCallOptions,
  ): Promise<IMCPToolCallResult>;
  /** Subscribe to `list_changed`; returns an unsubscribe. */
  onListChanged(listener: TMCPListChangedListener): () => void;
  /** Closes the SDK client and its transport. Idempotent. */
  close(): Promise<void>;
}

export interface IMCPOpenSessionOptions {
  readonly serverId: string;
  /** Explicit opt-in to the stateless 2026-07-28 wire path; omitted preserves legacy negotiation. */
  readonly protocolVersion?: string;
  /** Host opt-in to advertised Skills metadata and verified file reads; grants no activation. */
  readonly skills?: boolean;
  /** An already-ADMITTED transport (`./transport.ts`); this function never admits anything. */
  readonly transport: Transport;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly timeouts: IMCPSessionTimeouts;
  readonly signal?: AbortSignal;
}
