/**
 * Universal value type axis (recursive, JSON-like + Date).
 *
 * Extracted from `types.ts` into its own leaf module: several foundational modules (e.g.
 * `provider.ts`) need only this axis, not the rest of `types.ts` (which itself depends on
 * plugin-execution types) — importing the whole barrel there created a module-level import
 * cycle. `types.ts` re-exports these names, so existing `from './types'` imports are unaffected.
 *
 * IMPORTANT:
 * - This axis is the single source of truth for payload/context/result values.
 * - It must support nested objects/arrays without `any`/`unknown`.
 */

/**
 * Primitive value types - foundation for all other types
 * Extended to include null/undefined for agent contexts
 */
export type TPrimitiveValue = string | number | boolean | null | undefined;

export type TUniversalValue = TPrimitiveValue | Date | TUniversalArrayValue | IUniversalObjectValue;

export type TUniversalArrayValue = TUniversalValue[];

export interface IUniversalObjectValue {
  [key: string]: TUniversalValue;
}
