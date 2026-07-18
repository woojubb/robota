/**
 * SELFHOST-006 — per-role model routing policy (neutral, over the provider DIP).
 *
 * Pure resolution + fallback-walking over a `TRoleModelMap` (opaque role id → ordered fallback chain).
 * No provider coupling: the caller injects `run(ref)` which performs execution against the given
 * `{ provider, model }` using whatever provider the DIP resolves — so cross-provider fallback rides the
 * existing DIP with NO new provider→provider edge. The concrete role vocabulary lives in the product /
 * default layer, never here.
 */

import type { TRoleModelMap, TModelRef } from '@robota-sdk/agent-core';

/** Resolve the PRIMARY model for a role (first of its fallback chain); `undefined` if the role is unmapped. */
export function resolveRoleModel(map: TRoleModelMap, roleKey: string): TModelRef | undefined {
  return map[roleKey]?.[0];
}

/** The full ordered fallback chain for a role (primary first, then fallbacks); empty if unmapped. */
export function resolveRoleFallbackChain(map: TRoleModelMap, roleKey: string): TModelRef[] {
  return map[roleKey] ?? [];
}

/**
 * Walk a role's fallback chain, trying each `TModelRef` in order until one succeeds. `run(ref)` performs
 * the actual execution against the given provider+model over the DIP; on a thrown provider error it
 * advances to the next fallback (an alternate provider AND model). Throws the LAST error if the whole
 * chain is exhausted, or immediately if the chain is empty.
 */
export async function runWithRoleFallback<T>(
  chain: TModelRef[],
  run: (ref: TModelRef) => Promise<T>,
): Promise<T> {
  if (chain.length === 0) {
    throw new Error(
      'runWithRoleFallback: no model configured for this role (empty fallback chain)',
    );
  }
  let lastError: unknown;
  for (const ref of chain) {
    try {
      return await run(ref);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
