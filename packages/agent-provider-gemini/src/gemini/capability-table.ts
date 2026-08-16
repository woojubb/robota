/**
 * What Gemini's models can do. PROV-008.
 *
 * A vendor default with no deviations. The catalog declared one entry carrying this exact list; as a
 * default it now answers for every Gemini model rather than only the one that happened to be
 * enumerated — which is the behaviour a per-model gate needs, since a model absent from a catalog was
 * previously indistinguishable from a model that declares nothing.
 *
 * The claim and the date are the ones this repository already made.
 */

import { GEMINI_MODEL_LAST_VERIFIED_AT, GEMINI_MODEL_SOURCE_URL } from './provider-definition';

import type { IProviderCapabilityTable } from '@robota-sdk/agent-core';

export const GEMINI_CAPABILITY_TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'vision', 'json_schema', 'reasoning', 'streaming'],
  verifiedAt: GEMINI_MODEL_LAST_VERIFIED_AT,
  sourceUrl: GEMINI_MODEL_SOURCE_URL,
};
