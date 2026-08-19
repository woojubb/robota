/**
 * ARCH-029: the one guarantee every command-axis double makes about its overrides.
 *
 * It lives here rather than in either double because both make it, and review found the second copy
 * had been re-implemented inline with a comment pointing at "the sibling double" — two copies of a
 * guarantee drift, and this one had already been stated wrongly once.
 */

/**
 * An override may replace a member, never remove one.
 *
 * `Partial<T>` admits `{ setPlan: undefined }`, and object spread then writes that `undefined` over
 * the double's answer — reintroducing an ABSENT member at runtime, fully type-checked, which is the
 * exact state ARCH-029 S4 removed.
 *
 * The type alone does NOT close it, and an earlier revision of this comment claimed it did.
 * Measured: `NonNullable` strips `undefined` from the VALUE type, but the `?` modifier re-admits it
 * unless `exactOptionalPropertyTypes` is on, and it is set nowhere in this repo — so
 * `{ setPlan: undefined }` type-checks here with no cast. What the type DOES buy is `null`:
 * `{ setPlan: null }` is rejected under `strictNullChecks`. The `undefined` half of the guarantee is
 * enforced where it actually holds — {@link mergeOverrides} drops those values at merge time, which
 * is flag-independent.
 */
export type TOverrides<T> = { [K in keyof T]?: NonNullable<T[K]> };

/**
 * Spread `overrides` over `base`, ignoring any key whose value is `undefined`.
 *
 * This is the enforcement, not the type. `{ ...base, ...overrides }` writes an explicit `undefined`
 * straight through and removes a member the contract requires.
 */
export function mergeOverrides<T extends object>(base: T, overrides?: TOverrides<T>): T {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}
