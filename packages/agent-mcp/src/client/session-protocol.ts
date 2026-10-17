import { Client, SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import { TypeUtils } from '@robota-sdk/agent-core';
import { toUniversalObject } from '../catalog/universal-value.js';
import type { ServerCapabilities } from '@modelcontextprotocol/client';
import type { TMCPCapabilityDomain } from '../catalog/types.js';
import type { TMCPElicitationHandler } from './elicitation.js';
import type { IMCPToolCallResult } from './session-types.js';

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

export const DEFAULT_CLIENT_INFO = { name: 'mcp-client', version: '0.0.0' } as const;

/** The one explicitly selectable modern-era revision; selecting it grants no authority. */
export const STATELESS_PROTOCOL_VERSION = '2026-07-28';

/**
 * The one client both protocol eras are served by. Legacy negotiation by default; a pinned
 * revision never falls back. `auto` negotiation is deliberately not offered: it cannot recognise
 * this package's own stdio carrier. With an elicitation handler the client declares form-mode
 * elicitation only, and the SDK fulfils an `input_required` round through that same handler and
 * continues the call; without one no client input is offered and `input_required` surfaces as a
 * typed refusal the session turns into a carrier close (no automatic round, no replay).
 */
export function createMcpClient(
  clientInfo: { readonly name: string; readonly version: string },
  pinnedVersion?: string,
  elicitation?: TMCPElicitationHandler,
): Client {
  const client = new Client(
    { name: clientInfo.name, version: clientInfo.version },
    {
      capabilities: elicitation === undefined ? {} : { elicitation: { form: {} } },
      inputRequired: { autoFulfill: elicitation !== undefined },
      ...(pinnedVersion === undefined
        ? {}
        : { versionNegotiation: { mode: { pin: pinnedVersion } } }),
    },
  );
  if (elicitation !== undefined)
    client.setRequestHandler('elicitation/create', (request, ctx) =>
      elicitation(request.params, ctx.mcpReq.signal),
    );
  return client;
}

/** The SDK reports an aborted request as a timeout; callers tell them apart by their own signal. */
export function isRequestTimeout(error: unknown): boolean {
  return error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout;
}

/**
 * A tool result is a foreign body; converting the whole thing through `toUniversalObject` once,
 * here, is the boundary into the fields this session promises — every field read below is
 * `TUniversalValue`, never `unknown`.
 */
export function toToolCallResult(raw: unknown): IMCPToolCallResult {
  const converted = toUniversalObject(raw);
  const rawContent = converted['content'];
  const content = Array.isArray(rawContent) ? rawContent.filter(TypeUtils.isObject) : [];
  const structuredContentValue = converted['structuredContent'];
  const structuredContent = structuredContentValue;
  const isError = typeof converted['isError'] === 'boolean' ? converted['isError'] : false;
  return { content, structuredContent, isError };
}

export function buildDeclaredCapabilities(
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
