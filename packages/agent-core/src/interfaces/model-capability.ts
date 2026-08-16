/**
 * Reading the per-model capability vocabulary. PROV-006.
 *
 * `IProviderModelCatalogEntry.capabilities` exists precisely to say "this MODEL of this provider
 * cannot do X", and every provider populates it with real per-model distinctions. Nothing read it.
 * Tool gating asked a per-PROVIDER boolean instead, so a model whose catalog entry declares no
 * `tools` was offered tools anyway — and deepseek's `supportsTools()` returned an unconditional
 * `true` while its own catalog said `deepseek-reasoner` has none.
 *
 * The vocabulary is consumed rather than deleted. Deleting it would leave nothing able to express a
 * per-model answer, and the questions that need one are not going away: CORE-043 has to resolve a
 * structured-output mechanism per (provider, model), and vision gating is the same shape.
 *
 * **`undefined` is not `false`.** A catalog with no entry for a model, or an entry whose capability
 * list is absent OR empty, has said NOTHING — which is different from saying the model cannot do it.
 * (An empty list is the case a field-presence check misses, and `[].includes(x)` answers `false`
 * rather than "unknown", so it has to be excluded explicitly.) Treating
 * silence as denial would turn every unlisted model into a crippled one the moment this started
 * being read, so callers decide what to do with silence and the decision is visible at each site.
 */

import type {
  IProviderModelCatalog,
  IProviderModelCatalogEntry,
  TProviderModelCapability,
} from './provider-definition.js';

/**
 * The catalog entry for a model, matched by id or alias.
 *
 * Aliases matter here: `deepseek-chat` and `deepseek-reasoner` both alias the provider's default
 * model name, and a lookup that only compared ids would miss the model actually in use.
 */
export function findModelCatalogEntry(
  catalog: IProviderModelCatalog | undefined,
  modelId: string,
): IProviderModelCatalogEntry | undefined {
  return catalog?.entries?.find(
    (entry) => entry.id === modelId || entry.aliases?.includes(modelId) === true,
  );
}

/**
 * Whether a model declares a capability.
 *
 * Returns `undefined` when the catalog does not say — see the note above on why that is not `false`.
 */
export function modelDeclaresCapability(
  catalog: IProviderModelCatalog | undefined,
  modelId: string,
  capability: TProviderModelCapability,
): boolean | undefined {
  const entry = findModelCatalogEntry(catalog, modelId);
  // An EMPTY list is silence, not a blanket denial. `!entry?.capabilities` alone let `[]` through,
  // and `[].includes(x)` is `false` — so an entry that declares nothing would have been read as an
  // entry that declares nothing is possible, stripping tools from that model. That is the exact
  // inversion this module's contract forbids, in the one shape the field check does not catch.
  if (!entry?.capabilities || entry.capabilities.length === 0) return undefined;
  return entry.capabilities.includes(capability);
}

/**
 * Resolve a capability question with an explicit answer for silence.
 *
 * The shape every consumer wants: "does this model support X, and if the catalog is silent, what do
 * I assume?" Writing the assumption at the call site is the point — an assumption nobody states is
 * the reason this vocabulary went unread for as long as it did.
 */
export function resolveModelCapability(
  catalog: IProviderModelCatalog | undefined,
  modelId: string,
  capability: TProviderModelCapability,
  whenCatalogIsSilent: boolean,
): boolean {
  return modelDeclaresCapability(catalog, modelId, capability) ?? whenCatalogIsSilent;
}
