/**
 * What DeepSeek's models can do. PROV-008.
 *
 * A vendor default plus verified deviations, NOT an enumeration of models. The distinction is the
 * point: an enumeration is a per-model × six-flag matrix that rots the moment a model ships, while a
 * deviation list is short and every line in it is something somebody checked.
 *
 * Lifted from this package's own model catalog rather than re-researched — the capability claims and
 * the date below are the ones this repository already made. What changed is where they live: the
 * catalog is DISCOVERY and hangs off the provider DEFINITION, which the running provider never holds,
 * so nothing could read it at call time.
 */

import {
  DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
  DEEPSEEK_MODEL_LAST_VERIFIED_AT,
} from './model-catalog';

import type { IProviderCapabilityTable } from '@robota-sdk/agent-core';

export const DEEPSEEK_CAPABILITY_TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'json_schema', 'streaming'],
  deviations: {
    /**
     * The reasoning model has no function calling. This single line is what
     * `supportsTools() === true` used to contradict, and what nothing could read.
     */
    'deepseek-reasoner': {
      capabilities: ['reasoning', 'json_schema', 'streaming'],
      verifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
      sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
    },
  },
  verifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
  sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
};
