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
  vendorDefault: ['tools', 'vision', 'json_schema', 'reasoning', 'streaming'],
  verifiedAt: ANTHROPIC_MODEL_LAST_VERIFIED_AT,
};
