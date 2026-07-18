/**
 * SELFHOST-006 — per-role model routing contract (type-only, neutral).
 *
 * A role→model mapping keyed by an OPAQUE `string` role id — deliberately NOT a fixed
 * `planner|editor|reviewer` union and NOT a TS `enum`: a fixed vocabulary would embed an
 * app-workflow opinion into a neutral library. The concrete role set lives in the product/default
 * layer (`agent-provider-defaults` / `agent-cli`), never here. Mirrors the existing subagent
 * opaque-key model resolution (`resolveModelId` → `MODEL_SHORTCUTS[x] ?? x`).
 *
 * Each role maps to an ORDERED fallback chain: the first entry is the primary; the rest are
 * fallbacks in order. Each entry carries BOTH provider identity AND model — mirroring the global
 * `defaultModel: { provider, model }` — so "fall back to an alternate provider" is expressible (a
 * model id alone cannot express it).
 */

/** One provider+model target in a role's fallback chain. */
export interface IModelRef {
  provider: string;
  model: string;
}

/** Opaque role id → ordered fallback chain (primary first, then fallbacks in order). */
export type TRoleModelMap = Record<string, IModelRef[]>;
