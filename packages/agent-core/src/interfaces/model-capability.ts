/**
 * What a model can do, and where that answer lives. PROV-006 / PROV-008.
 *
 * PROV-006 made the per-model capability vocabulary readable: `tools`, `vision`, `json_schema`,
 * `reasoning`, `native_web`, `streaming`. PROV-008 moved it out of the struct it was sharing.
 *
 * `IProviderModelCatalogEntry` carried three payloads with nothing in common — which models EXIST
 * (dynamic, per-account, refreshable), what a model CAN DO (static, versioned with the adapter), and
 * what a model COSTS (static, versioned with vendor pricing) — hanging off `IProviderDefinition`, a
 * registry artifact the provider instance never holds. So nothing at runtime could read any of it,
 * and the live-refresh path could not have populated the static halves anyway: it builds entries from
 * a models-list endpoint that returns ids and nothing else.
 *
 * Capability is therefore its own thing, declared by the package that ships the adapter and reachable
 * from the provider INSTANCE. Discovery stays where it belongs, on the definition.
 *
 * Two rules this file exists to hold:
 *
 * 1. **A capability table states the VENDOR DEFAULT plus verified deviations** — not an enumeration
 *    of every model. An enumeration is a per-model × six-flag matrix nobody maintains and that
 *    silently rots; a deviation list is short, and each entry is something somebody checked.
 * 2. **A miss resolves to the vendor default, never to a negative.** A model absent from the
 *    deviation list is an ordinary model, not a crippled one. A provider with no table at all has
 *    said NOTHING — different again from saying no, and what `undefined` means below.
 */

import type { TProviderModelCapability } from './provider-definition.js';

/** One model that verifiably differs from its vendor's default, and when that was checked. */
export interface IModelCapabilityDeviation {
  /** The complete capability set for this model — not a delta against the default. */
  capabilities: readonly TProviderModelCapability[];
  /** ISO date this deviation was verified against the vendor's documentation. */
  verifiedAt: string;
  sourceUrl?: string;
}

/**
 * What a provider package declares about its own models.
 *
 * A package with no verified source for its vendor's baseline declares NO TABLE rather than an empty
 * one: an empty default would resolve every capability to "false", which is the silence-read-as-denial
 * inversion this contract exists to forbid.
 */
export interface IProviderCapabilityTable {
  /** What this vendor's models can do unless a model below says otherwise. */
  vendorDefault: readonly TProviderModelCapability[];
  /** Only models that verifiably differ. Absent means none do. */
  deviations?: Readonly<Record<string, IModelCapabilityDeviation>>;
  /** ISO date the vendor default was verified. */
  verifiedAt: string;
  sourceUrl?: string;
}

/**
 * The capability set that applies to a model, or `undefined` when nothing has been declared.
 *
 * A model with no deviation gets the vendor default — the rule that makes a short table safe.
 */
export function resolveModelCapabilities(
  table: IProviderCapabilityTable | undefined,
  modelId: string,
): readonly TProviderModelCapability[] | undefined {
  if (!table) return undefined;
  return table.deviations?.[modelId]?.capabilities ?? table.vendorDefault;
}

/**
 * Whether a model declares a capability.
 *
 * Returns `undefined` when nothing has said — no table, or a table with no answer for this model.
 */
export function modelDeclaresCapability(
  table: IProviderCapabilityTable | undefined,
  modelId: string,
  capability: TProviderModelCapability,
): boolean | undefined {
  const capabilities = resolveModelCapabilities(table, modelId);
  // An EMPTY list is silence, not a blanket denial. A presence check alone lets `[]` through, and
  // `[].includes(x)` answers `false` — so a table whose author had not filled the list in yet would
  // read as a model that can do nothing, stripping its tools. That is the exact inversion this
  // module's contract forbids, in the one shape a presence check does not catch.
  if (!capabilities || capabilities.length === 0) return undefined;
  return capabilities.includes(capability);
}

/**
 * Resolve a capability question with an explicit answer for silence.
 *
 * The shape every consumer wants: "can this model do X, and if nothing has said, what do I assume?"
 * Writing the assumption at the call site is the point — an assumption nobody states is the reason
 * this vocabulary went unread for as long as it did.
 */
export function resolveModelCapability(
  table: IProviderCapabilityTable | undefined,
  modelId: string,
  capability: TProviderModelCapability,
  whenNothingIsDeclared: boolean,
): boolean {
  return modelDeclaresCapability(table, modelId, capability) ?? whenNothingIsDeclared;
}
