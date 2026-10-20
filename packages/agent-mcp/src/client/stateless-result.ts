import type { Result, StandardSchemaV1 } from '@modelcontextprotocol/client';
import type { IMCPResponseCacheHint } from '../catalog/types.js';

/** Permanent wire incompatibility; labels never include arbitrary peer text. */
export class MCPStatelessProtocolError extends Error {
  constructor(readonly reason: 'input_required' | 'unknown-result' | 'invalid-tool-result') {
    super(`Unsupported stateless MCP result: ${reason}; inspect the operation before any retry`);
    this.name = 'MCPStatelessProtocolError';
  }
}

export function statelessCacheHint(result: Result): IMCPResponseCacheHint {
  if (
    typeof result.ttlMs !== 'number' ||
    !Number.isFinite(result.ttlMs) ||
    result.ttlMs < 0 ||
    (result.cacheScope !== 'public' && result.cacheScope !== 'private')
  )
    throw new Error('Invalid stateless MCP cache metadata');
  return { ttlMs: result.ttlMs, cacheScope: result.cacheScope, receivedAtMs: Date.now() };
}

/**
 * Accepts any JSON object as the result of a method the SDK does not define (`skills/list`,
 * `skills/get`). The SDK has already required the completion discriminator; the shape of the body
 * is the caller's to verify.
 */
export const OBJECT_RESULT_SCHEMA: StandardSchemaV1<Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'robota-agent-mcp',
    validate: (value) =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { value: value as Record<string, unknown> }
        : { issues: [{ message: 'expected a result object' }] },
  },
};
