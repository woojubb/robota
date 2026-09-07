/**
 * What Anthropic's models can do. PROV-008.
 *
 * A vendor default with NO deviations, and that emptiness is the finding rather than a gap: the model
 * catalog assigned the identical capability list to every entry it produced, which is a vendor
 * default written out once per model. Stated once, it is maintainable; repeated per entry it is
 * three-plus copies that drift the first time one is edited.
 *
 * The claim and the date are the ones this repository already made.
 */

import { ANTHROPIC_MODEL_LAST_VERIFIED_AT } from './provider-definition';

import type { IProviderCapabilityTable } from '@robota-sdk/agent-core';

export const ANTHROPIC_CAPABILITY_TABLE: IProviderCapabilityTable = {
  // CLI-1990: `tool_search` records that THIS vendor documents a server-side tool search — deferred
  // definitions the API expands on demand (`tool_search_tool_*_20251119`, per-tool `defer_loading`).
  // It is a DECLARATION, not a switch: Robota v1 runs its own client-side catalog on every provider
  // and emits no vendor block, because the vendor feature keeps definitions out of the context
  // window while still sending every one of them in the request. The flag exists so a later offload
  // can be gated on this table rather than on a provider name. Anthropic is the only table in the
  // tree that declares it; Gemini has no equivalent feature, and the OpenAI provider publishes no
  // capability table at all, so its documented support is not expressible here.
  vendorDefault: ['tools', 'vision', 'json_schema', 'reasoning', 'streaming', 'tool_search'],
  verifiedAt: ANTHROPIC_MODEL_LAST_VERIFIED_AT,
};
