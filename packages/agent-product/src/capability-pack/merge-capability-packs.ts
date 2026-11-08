import type {
  ICapabilityPack,
  ICapabilityPackMetadata,
  IMergedCapabilities,
  IRejectedCapability,
  IRejectedCapabilityPack,
  TCapabilityKind,
  TCompositionFieldPolicy,
} from './capability-pack-types.js';
import type { FunctionTool } from '@robota-sdk/agent-core';
import type { IAgentDefinition, ICommandModule } from '@robota-sdk/agent-framework';

export const CAPABILITY_PACK_FIELD_POLICIES = {
  id: 'consumed-and-surfaced',
  title: 'surfaced',
  description: 'surfaced',
  commandModules: 'consumed',
  tools: 'consumed',
  subagents: 'consumed',
} as const satisfies Record<keyof ICapabilityPack, TCompositionFieldPolicy>;

function toPackMetadata(pack: ICapabilityPack): ICapabilityPackMetadata {
  return {
    id: pack.id,
    ...(pack.title !== undefined ? { title: pack.title } : {}),
    ...(pack.description !== undefined ? { description: pack.description } : {}),
  };
}

function selectUniquePacks(packs: readonly ICapabilityPack[]): {
  accepted: readonly ICapabilityPack[];
  acceptedPacks: readonly ICapabilityPackMetadata[];
  rejectedPacks: readonly IRejectedCapabilityPack[];
} {
  const claimedPackIds = new Set<string>();
  const accepted: ICapabilityPack[] = [];
  const acceptedPacks: ICapabilityPackMetadata[] = [];
  const rejectedPacks: IRejectedCapabilityPack[] = [];
  for (const pack of packs) {
    if (claimedPackIds.has(pack.id)) {
      rejectedPacks.push({ packId: pack.id, reason: 'duplicate pack id' });
      continue;
    }
    claimedPackIds.add(pack.id);
    accepted.push(pack);
    acceptedPacks.push(toPackMetadata(pack));
  }
  return { accepted, acceptedPacks, rejectedPacks };
}

/**
 * Merge capability packs additively into the product's base command modules.
 *
 * The additive analog of `resolvePreset` — a PURE, deterministic, IO-free fold. Given a product's
 * `baseCommandModules` and its `packs` (in profile order), it produces the `base ⊕ pack` superset and a
 * `{ merged, rejected }` result (mirroring `IPresetRegistrationResult`).
 *
 * **ONE precedence order, no silent override:** `baseCommandModules` < packs in profile order. A later
 * contribution whose id duplicates an already-claimed id is REJECTED and reported in `rejected` — never
 * silently overridden (mirrors `partitionExternalPresets`' "the first one wins / report rejection").
 * Ids are claimed per bucket: command modules by `ICommandModule.name`, tools by `FunctionTool.getName()`,
 * subagents by `IAgentDefinition.name`.
 *
 * This merger produces only the base ⊕ pack **superset**. A preset's
 * `enabledCommandModules`/`disabledCommandModules` delta is applied AFTER this merge by the product shell's
 * command-setup (as it does today) — the two compose (this widens, the preset delta filters), they do not
 * fight.
 *
 * Pure w.r.t. its arguments: it reads only its inputs and returns fresh arrays; it mutates neither
 * `baseCommandModules` nor any pack.
 */
export function mergeCapabilityPacks(
  baseCommandModules: readonly ICommandModule[],
  packs: readonly ICapabilityPack[],
): IMergedCapabilities {
  const rejected: IRejectedCapability[] = [];
  const { accepted, acceptedPacks, rejectedPacks } = selectUniquePacks(packs);

  const commandModules = mergeBucket<ICommandModule>({
    kind: 'commandModule',
    base: baseCommandModules,
    packs: accepted,
    contributionsOf: (pack) => pack.commandModules ?? [],
    idOf: (module) => module.name,
    baseCollisionReason: 'collides with base command module',
    duplicateReason: 'duplicate commandModule id',
    rejected,
  });

  const tools = mergeBucket<FunctionTool>({
    kind: 'tool',
    base: [],
    packs: accepted,
    contributionsOf: (pack) => pack.tools ?? [],
    idOf: (tool) => tool.getName(),
    baseCollisionReason: 'collides with base tool',
    duplicateReason: 'duplicate tool id',
    rejected,
  });

  const subagents = mergeBucket<IAgentDefinition>({
    kind: 'subagent',
    base: [],
    packs: accepted,
    contributionsOf: (pack) => pack.subagents ?? [],
    idOf: (agent) => agent.name,
    baseCollisionReason: 'collides with base subagent',
    duplicateReason: 'duplicate subagent id',
    rejected,
  });

  return {
    merged: { commandModules, tools, subagents },
    acceptedPacks,
    rejected,
    rejectedPacks,
  };
}

interface IMergeBucketArgs<T> {
  kind: TCapabilityKind;
  /** Already-present base entries (own the namespace first). */
  base: readonly T[];
  /** Accepted packs in profile order and the bucket projection for each pack. */
  packs: readonly ICapabilityPack[];
  contributionsOf: (pack: ICapabilityPack) => readonly T[];
  idOf: (entry: T) => string;
  baseCollisionReason: string;
  duplicateReason: string;
  rejected: IRejectedCapability[];
}

/**
 * Fold one capability bucket: base entries claim the namespace first, then each pack's contributions in
 * order. A contribution whose id is already claimed is pushed to `rejected` (base collision vs pack-vs-pack
 * duplicate carry distinct reasons) and dropped from the merged output. First registration always wins.
 */
function mergeBucket<T>(args: IMergeBucketArgs<T>): readonly T[] {
  const {
    kind,
    base,
    packs,
    contributionsOf,
    idOf,
    baseCollisionReason,
    duplicateReason,
    rejected,
  } = args;
  const claimed = new Set<string>();
  const baseIds = new Set<string>();
  const merged: T[] = [];

  for (const entry of base) {
    const id = idOf(entry);
    claimed.add(id);
    baseIds.add(id);
    merged.push(entry);
  }

  for (const pack of packs) {
    for (const entry of contributionsOf(pack)) {
      const id = idOf(entry);
      if (claimed.has(id)) {
        rejected.push({
          packId: pack.id,
          kind,
          id,
          reason: baseIds.has(id) ? baseCollisionReason : duplicateReason,
        });
        continue;
      }
      claimed.add(id);
      merged.push(entry);
    }
  }

  return merged;
}
