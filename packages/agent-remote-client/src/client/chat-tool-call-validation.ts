/**
 * Shared tool-call payload validation for the chat HTTP methods.
 *
 * Owned in one place so the streaming and non-streaming halves cannot drift on what counts as a
 * well-formed tool call -- the split into two files is a size constraint, not two contracts.
 */

import type { IToolCall } from '@robota-sdk/agent-core';

/**
 * Validate that an array of unknown values conforms to IToolCall[].
 * Filters out entries that do not have the required shape.
 */
export function validateToolCallArray(items: unknown[]): IToolCall[] {
  return items.filter(
    (item): item is IToolCall =>
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      typeof (item as Record<string, unknown>)['id'] === 'string' &&
      'type' in item &&
      (item as Record<string, unknown>)['type'] === 'function' &&
      'function' in item &&
      typeof (item as Record<string, unknown>)['function'] === 'object' &&
      (item as Record<string, unknown>)['function'] !== null,
  );
}
