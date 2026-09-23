import { DEFAULT_TOOL_RESULT_HARD_CHARS, MAX_TOOL_RESULT_CHARS } from '@robota-sdk/agent-core';

/**
 * The only MCP tool metadata key Robota interprets for result admission. The raw `_meta` object
 * never reaches the catalog or diagnostics.
 */
const MCP_RESULT_SIZE_METADATA_KEY = ['anthropic', 'maxResultSizeChars'].join('/');

export type TMCPResultSizeMetadata =
  | { readonly kind: 'absent' }
  | { readonly kind: 'accepted'; readonly maxResultChars: number }
  | { readonly kind: 'invalid'; readonly reason: 'invalid-type' | 'out-of-range' };

/** Projects one strictly typed, bounded upward request without retaining source metadata. */
export function parseMCPResultSizeMetadata(rawMeta: unknown): TMCPResultSizeMetadata {
  if (rawMeta === undefined) return { kind: 'absent' };
  if (rawMeta === null || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
    return { kind: 'invalid', reason: 'invalid-type' };
  }
  const meta = rawMeta as Record<string, unknown>;
  if (!Object.hasOwn(meta, MCP_RESULT_SIZE_METADATA_KEY)) return { kind: 'absent' };
  const value = meta[MCP_RESULT_SIZE_METADATA_KEY];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return { kind: 'invalid', reason: 'invalid-type' };
  }
  if (value <= DEFAULT_TOOL_RESULT_HARD_CHARS || value > MAX_TOOL_RESULT_CHARS) {
    return { kind: 'invalid', reason: 'out-of-range' };
  }
  return { kind: 'accepted', maxResultChars: value };
}
