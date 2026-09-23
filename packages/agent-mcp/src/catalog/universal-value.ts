/**
 * Boundary conversion into the core SSOT value axis (MCP-002).
 *
 * An MCP response body (a `callTool` result, a discovered tool's `outputSchema`, …) is a foreign,
 * JSON-ish shape the SDK hands back untyped. `toUniversalValue`/`toUniversalObject` are the ONE place
 * that shape is converted into `TUniversalValue`/`IUniversalObjectValue` — every other call site in
 * this package imports the result rather than typing itself `unknown`.
 */

import { TypeUtils } from '@robota-sdk/agent-core';

import type { IUniversalObjectValue, TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Converts an arbitrary JSON-ish value (an MCP response body) into the canonical value axis.
 *
 * `value` is legitimately `unknown` here: this is the boundary this package's SSOT policy names as
 * the one place a foreign value enters before every other site sees only `TUniversalValue`.
 */
export function toUniversalValue(value: unknown): TUniversalValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => toUniversalValue(item));
  if (typeof value === 'object') {
    const result: Record<string, TUniversalValue> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toUniversalValue(nested);
    }
    return result;
  }
  // `undefined`, a function, a symbol, a bigint — outside the universal value axis. Stringifying
  // keeps the data visible rather than dropping it silently.
  return String(value);
}

/** Converts to the object member of the value axis specifically; a non-object input becomes `{}`. */
export function toUniversalObject(value: unknown): IUniversalObjectValue {
  const converted = toUniversalValue(value);
  return TypeUtils.isObject(converted) ? converted : {};
}
