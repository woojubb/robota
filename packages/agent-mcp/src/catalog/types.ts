/**
 * Canonical MCP catalog vocabulary (MCP-002).
 *
 * These types are the shared contract between the client seam (`../client/`), the supervisor
 * (`../supervisor/`) and the catalog builder (`./build.ts`). They describe what a server SAID it
 * offers and what this package DECIDED to expose — never a connection, never a secret.
 */

import type { TMCPResultSizeMetadata } from './result-size-metadata.js';
import type { IParameterSchema, IUniversalObjectValue } from '@robota-sdk/agent-core';

export type TMCPCapabilityDomain = 'tools' | 'prompts' | 'resources';

/**
 * Three-valued on purpose (spec § Decision): a capability the server never declared is
 * `unsupported` and is NEVER called; one it declared with zero items is `supported` with
 * `count: 0`. A two-valued model cannot tell those apart, and calling an undeclared capability
 * violates "only use capabilities that were successfully negotiated".
 */
export type TMCPCapabilityState =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'supported'; readonly count: number; readonly listChanged: boolean };

/** What binds a catalog to the server that produced it. Rotating a token changes none of these. */
export interface IMCPServerIdentity {
  readonly serverId: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly protocolVersion: string;
}

export interface IMCPDiscoveredTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: IParameterSchema;
  readonly outputSchema?: IUniversalObjectValue;
  /** Validated projection only; the server's raw `_meta` never enters the catalog. */
  readonly resultSizeMetadata?: Exclude<TMCPResultSizeMetadata, { readonly kind: 'absent' }>;
}

export interface IMCPDiscoveredPromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface IMCPDiscoveredPrompt {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly IMCPDiscoveredPromptArgument[];
}

export interface IMCPDiscoveredResource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/** One domain's discovery outcome. `pages` is how many list requests it took (bounded by the driver). */
export interface IMCPDiscoveryDomainResult<TItem> {
  readonly state: TMCPCapabilityState;
  readonly items: readonly TItem[];
  readonly pages: number;
}

/** Everything one initialized session disclosed. Pure data; no live handle. */
export interface IMCPDiscovery {
  readonly identity: IMCPServerIdentity;
  readonly instructions?: string;
  readonly tools: IMCPDiscoveryDomainResult<IMCPDiscoveredTool>;
  readonly prompts: IMCPDiscoveryDomainResult<IMCPDiscoveredPrompt>;
  readonly resources: IMCPDiscoveryDomainResult<IMCPDiscoveredResource>;
}

export type TMCPDiscoveryFailureKind =
  'invalid-cursor' | 'page-bound-exceeded' | 'timeout' | 'protocol';

export interface IMCPDiscoveryFailure {
  readonly kind: TMCPDiscoveryFailureKind;
  readonly domain: TMCPCapabilityDomain;
  readonly message: string;
  /** JSON-RPC error code when the server returned one (e.g. `-32602` for an invalid cursor). */
  readonly code?: number;
  readonly pagesSeen: number;
}

/** A named domain failure. A partial catalog is never reported as complete. */
export class MCPDiscoveryError extends Error {
  constructor(readonly failure: IMCPDiscoveryFailure) {
    super(`MCP discovery failed (${failure.domain}, ${failure.kind}): ${failure.message}`);
    this.name = 'MCPDiscoveryError';
  }
}

export type TMCPCatalogDisposition = 'adopted' | 'adapted' | 'rejected';

export interface IMCPCatalogProvenance {
  readonly serverId: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly protocolVersion: string;
  /** Where the definition came from (a file path, plugin id or policy name), copied from the definition. */
  readonly origin: string;
}

/** Exposed name budget; the naming module middle-truncates deterministically to fit it. */
export const MCP_CANONICAL_NAME_BUDGET = 64;

/** `<server-id>__<tool-name>`, sanitised to `[A-Za-z0-9_-]`, budgeted. Owned by `./naming.ts`. */
export type TMCPCanonicalName = string;

export interface IMCPCatalogToolEntry {
  readonly kind: 'tool';
  readonly canonicalName: TMCPCanonicalName;
  readonly sourceName: string;
  readonly description?: string;
  /** The enforceable copy (CORE-040 narrowing applied at registration). */
  readonly schema: IParameterSchema;
  /** Validated upward request; admission still enforces its configured repository cap. */
  readonly maxResultChars?: number;
  /** Paths dropped by narrowing; empty when the whole schema is enforceable. */
  readonly unenforceablePaths: readonly string[];
  readonly provenance: IMCPCatalogProvenance;
  readonly disposition: Exclude<TMCPCatalogDisposition, 'rejected'>;
  /** Why the entry is `adapted` rather than `adopted` (renamed, truncated, narrowed). */
  readonly reason?: string;
}

export interface IMCPCatalogPromptEntry {
  readonly kind: 'prompt';
  readonly canonicalName: TMCPCanonicalName;
  readonly sourceName: string;
  readonly description?: string;
  readonly arguments: readonly IMCPDiscoveredPromptArgument[];
  readonly provenance: IMCPCatalogProvenance;
  readonly disposition: Exclude<TMCPCatalogDisposition, 'rejected'>;
  readonly reason?: string;
}

export interface IMCPCatalogResourceEntry {
  readonly kind: 'resource';
  readonly canonicalName: TMCPCanonicalName;
  readonly uri: string;
  readonly sourceName: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly provenance: IMCPCatalogProvenance;
  readonly disposition: Exclude<TMCPCatalogDisposition, 'rejected'>;
  readonly reason?: string;
}

export type TMCPCatalogEntry =
  IMCPCatalogToolEntry | IMCPCatalogPromptEntry | IMCPCatalogResourceEntry;

/** Anything not exposed, WITH the reason. Silence is the one disposition this catalog does not have. */
export interface IMCPCatalogRejection {
  readonly kind: 'server' | 'tool' | 'prompt' | 'resource';
  readonly serverId: string;
  readonly name: string;
  readonly reason: string;
}

export interface IMCPCatalogServerEntry {
  readonly serverId: string;
  readonly origin: string;
  readonly transport: 'streamable-http' | 'stdio';
  /** Absent when the server was rejected before a session existed (unsupported transport). */
  readonly identity?: IMCPServerIdentity;
  readonly instructions?: string;
  readonly capabilities: Readonly<Record<TMCPCapabilityDomain, TMCPCapabilityState>>;
}

export interface IMCPCatalog {
  readonly servers: readonly IMCPCatalogServerEntry[];
  readonly adopted: readonly TMCPCatalogEntry[];
  readonly adapted: readonly TMCPCatalogEntry[];
  readonly rejected: readonly IMCPCatalogRejection[];
}

/** Identity a retained last-known-good catalog is bound to; a mismatch on reconnect invalidates it. */
export interface IMCPCatalogIdentity {
  readonly serverId: string;
  readonly protocolVersion: string;
  readonly serverVersion: string;
}

export function catalogIdentityOf(identity: IMCPServerIdentity): IMCPCatalogIdentity {
  return {
    serverId: identity.serverId,
    protocolVersion: identity.protocolVersion,
    serverVersion: identity.serverVersion,
  };
}

export function sameCatalogIdentity(a: IMCPCatalogIdentity, b: IMCPCatalogIdentity): boolean {
  return (
    a.serverId === b.serverId &&
    a.protocolVersion === b.protocolVersion &&
    a.serverVersion === b.serverVersion
  );
}
