/**
 * @robota-sdk/agent-capability-pack — the additive capability-bundle contract (`ICapabilityPack`) and the
 * pure `mergeCapabilityPacks` merger. The additive analog of `@robota-sdk/agent-preset`: a contract + pure
 * fold package with no IO. Depends on `@robota-sdk/agent-framework` and `@robota-sdk/agent-core` for
 * contract types only.
 */

export type {
  ICapabilityPack,
  ICapabilityPackMetadata,
  IMergedCapabilities,
  IRejectedCapability,
  IRejectedCapabilityPack,
  TCapabilityKind,
  TCompositionFieldPolicy,
} from './capability-pack-types.js';

export { mergeCapabilityPacks } from './merge-capability-packs.js';
