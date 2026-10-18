/** Shared session contracts; both protocol implementations depend on this leaf module. */
import type { IMCPSkillsSession } from '../skills/types.js';
import type { Transport } from '@modelcontextprotocol/client';
import type {
  IOutboundTraceContext,
  IUniversalObjectValue,
  IUserInteraction,
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
  /**
   * The calling tool body's ask port. A form-mode elicitation the server raises during this call is
   * put to a person through it; absent, such a request is declined on the server's behalf.
   */
  readonly ask?: IUserInteraction['ask'];
}

export interface IMCPToolCallResult {
  readonly content: readonly IUniversalObjectValue[];
  readonly structuredContent?: TUniversalValue;
  readonly isError: boolean;
}

export interface IMCPReadResourceOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** The contents of one `resources/read`, as the server sent them; the reader validates what it needs. */
export interface IMCPReadResourceResult {
  readonly contents: readonly IUniversalObjectValue[];
}

/** Fired by the SDK when a server announces `notifications/<domain>/list_changed`. */
export type TMCPListChangedListener = (domain: TMCPCapabilityDomain) => void;

export interface IMCPSession {
  readonly skills?: IMCPSkillsSession;
  /**
   * True only when MCP Apps was negotiated: the host opted in, the server declared the UI extension
   * and it declared resources. Tool UI metadata is kept in discovery only then.
   */
  readonly apps?: boolean;
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
  /**
   * One bounded `resources/read`. Refused when the server did not declare resources, like any
   * other undeclared capability; the caller validates the contents it asked for.
   */
  readResource(uri: string, options?: IMCPReadResourceOptions): Promise<IMCPReadResourceResult>;
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
  /**
   * Host opt-in to form-mode elicitation: declares the capability and answers a server's request
   * during a tool call through that call's ask port. Off, no client input is offered at all.
   */
  readonly elicitation?: boolean;
  /**
   * Host opt-in to MCP Apps: declares the UI extension so a server may attach tool views; set only
   * where a surface can show them in an isolated frame.
   */
  readonly apps?: boolean;
  /** An already-ADMITTED transport (`./transport.ts`); this function never admits anything. */
  readonly transport: Transport;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly timeouts: IMCPSessionTimeouts;
  readonly signal?: AbortSignal;
}
