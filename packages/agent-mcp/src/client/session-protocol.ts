import { TypeUtils } from '@robota-sdk/agent-core';
import { toUniversalObject } from '../catalog/universal-value.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type { TMCPCapabilityDomain } from '../catalog/types.js';
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

/**
 * The SDK's `callTool` return type is a union with a legacy `toolResult`-only compatibility shape
 * (no `content`/`isError`); converting the whole thing through `toUniversalObject` once, here, is
 * the boundary into the fields this session promises — every field read below is `TUniversalValue`,
 * never `unknown`.
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
