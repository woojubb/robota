import { CallToolResultSchema, ListToolsResultSchema, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Result } from '@modelcontextprotocol/sdk/types.js';
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

/** Pinned stateless output accepts any JSON value; content remains mandatory. */
export const StatelessToolResultSchema = CallToolResultSchema.omit({ structuredContent: true }).extend({
  content: CallToolResultSchema.shape.content.removeDefault(),
});

/** The new wire permits arbitrary JSON Schema output roots and boolean property schemas. */
export const StatelessToolsListSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.extend({
    inputSchema: ToolSchema.shape.inputSchema.omit({ properties: true }),
    outputSchema: ToolSchema.shape.outputSchema.unwrap().omit({ type: true, properties: true, required: true }).optional(),
  }).array(),
});
