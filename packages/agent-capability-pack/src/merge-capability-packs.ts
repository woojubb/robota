import type {
  ICapabilityPack,
  IMergedCapabilities,
  IRejectedCapability,
  TCapabilityKind,
} from './capability-pack-types.js';
import type { FunctionTool } from '@robota-sdk/agent-core';
import type { IAgentDefinition, ICommandModule } from '@robota-sdk/agent-framework';

/**
 * Merge capability packs additively into the product's base command modules.
 *
 * The additive analog of `resolvePreset` — a PURE, deterministic, IO-free fold. Given a product's
 * `baseCommandModules` and its `packs` (in profile order), it produces the `base ⊕ pack` superset and a
 * `{ merged, rejected }` result (mirroring `IPresetRegistrationResult`).
 *
 * **ONE precedence order, no silent override:** `baseCommandModules` < packs in profile order. A later
 * contribution whose id duplicates an already-claimed id is REJECTED and reported in `rejected` — never
 * silently overridden (mirrors `registerExternalPresets`' "first registration wins / report rejection").
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

  const commandModules = mergeBucket<ICommandModule>({
    kind: 'commandModule',
    base: baseCommandModules,
    contributions: packs.map((pack) => pack.commandModules ?? []),
    idOf: (module) => module.name,
    baseCollisionReason: 'collides with base command module',
    duplicateReason: 'duplicate commandModule id',
    rejected,
  });

  const tools = mergeBucket<FunctionTool>({
    kind: 'tool',
    base: [],
    contributions: packs.map((pack) => pack.tools ?? []),
    idOf: (tool) => tool.getName(),
    baseCollisionReason: 'collides with base tool',
    duplicateReason: 'duplicate tool id',
    rejected,
  });

  const subagents = mergeBucket<IAgentDefinition>({
    kind: 'subagent',
    base: [],
    contributions: packs.map((pack) => pack.subagents ?? []),
    idOf: (agent) => agent.name,
    baseCollisionReason: 'collides with base subagent',
    duplicateReason: 'duplicate subagent id',
    rejected,
  });

  return { merged: { commandModules, tools, subagents }, rejected };
}

interface IMergeBucketArgs<T> {
  kind: TCapabilityKind;
  /** Already-present base entries (own the namespace first). */
  base: readonly T[];
  /** Per-pack contributions, in profile order. */
  contributions: readonly (readonly T[])[];
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
  const { kind, base, contributions, idOf, baseCollisionReason, duplicateReason, rejected } = args;
  const claimed = new Set<string>();
  const merged: T[] = [];

  for (const entry of base) {
    const id = idOf(entry);
    claimed.add(id);
    merged.push(entry);
  }

  for (const contribution of contributions) {
    for (const entry of contribution) {
      const id = idOf(entry);
      if (claimed.has(id)) {
        const isBaseCollision = base.some((baseEntry) => idOf(baseEntry) === id);
        rejected.push({
          kind,
          id,
          reason: isBaseCollision ? baseCollisionReason : duplicateReason,
        });
        continue;
      }
      claimed.add(id);
      merged.push(entry);
    }
  }

  return merged;
}
