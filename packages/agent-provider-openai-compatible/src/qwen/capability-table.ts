/**
 * What Qwen's models can do. PROV-008.
 *
 * A vendor default plus verified deviations. Qwen is the clearest example of why that shape is the
 * right one: `qwen-plus` and `qwen-max` share the vendor's full set, and only `qwen-flash` differs —
 * one line instead of three near-identical rows that drift apart the first time one is edited.
 *
 * Lifted from this package's own model catalog; the claims and the date are the ones this repository
 * already made.
 */

import { QWEN_MODEL_LAST_VERIFIED_AT, QWEN_MODEL_SOURCE_URL } from './defaults';

import type { IProviderCapabilityTable } from '@robota-sdk/agent-core';

export const QWEN_CAPABILITY_TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'reasoning', 'native_web', 'streaming'],
  deviations: {
    /** The fast model does not reason. */
    'qwen-flash': {
      capabilities: ['tools', 'native_web', 'streaming'],
      verifiedAt: QWEN_MODEL_LAST_VERIFIED_AT,
      sourceUrl: QWEN_MODEL_SOURCE_URL,
    },
  },
  verifiedAt: QWEN_MODEL_LAST_VERIFIED_AT,
  sourceUrl: QWEN_MODEL_SOURCE_URL,
};
