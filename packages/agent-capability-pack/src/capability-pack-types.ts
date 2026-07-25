import type { FunctionTool } from '@robota-sdk/agent-core';
import type { IAgentDefinition, ICommandModule } from '@robota-sdk/agent-framework';

/**
 * ARCH-005 — the additive capability-bundle contract.
 *
 * An `ICapabilityPack` is the *additive* composition unit of the Robota product surface: a plain data
 * record of named capability buckets a consumer brings on top of a product's base command modules. It is
 * the additive analog of `IPreset` — where a preset dials **behavior** (subtractive tool/command
 * selection, persona, permission posture), a pack contributes **capability** (new tools, command modules,
 * and subagents).
 *
 * **A pack is NOT declarative JSON (R6).** Unlike a serialized manifest (e.g. VS Code's `contributes`
 * block, which the host reads without running contributor code), a pack carries **executable code
 * objects** — `ICommandModule` values with `systemCommands` handlers, `FunctionTool` instances with
 * `execute` functions, and subagent definitions. It is an **in-process composition argument**, a live
 * value handed to the assembler, not a serialized declaration. The "no function across a serialization
 * boundary" property that applies to VS Code manifests is therefore simply N/A here.
 *
 * The honest safety property is not "inert JSON" but: **packs are OPT-IN** (present only when a product
 * profile lists them), **the merge is pure** (`mergeCapabilityPacks` executes none of the contributed
 * code), and **any contributed command/tool runs ONLY through the existing permission-gated runtime**
 * (`PermissionEnforcer`) at call time — never by the mere act of being merged.
 *
 * The contract layer performs no IO and declares no classes with side effects. It depends on
 * `@robota-sdk/agent-framework` and `@robota-sdk/agent-core` for **contract types only**.
 */
export interface ICapabilityPack {
  /** Stable pack id (diagnostics + duplicate-pack reporting). */
  id: string;
  /** Human-readable pack title for discovery/UX. */
  title?: string;
  /** Human-readable pack description for discovery/UX. */
  description?: string;

  // All buckets are additive and optional — merged INTO the assembled runtime, never subtractive.

  /** Command modules the pack contributes (identified by `ICommandModule.name`). */
  commandModules?: readonly ICommandModule[];
  /** Tools the pack contributes (identified by `FunctionTool.getName()`). */
  tools?: readonly FunctionTool[];
  /** Subagent definitions the pack contributes (identified by `IAgentDefinition.name`). */
  subagents?: readonly IAgentDefinition[];
}

/** The `kind` of a rejected capability contribution. */
export type TCapabilityKind = 'commandModule' | 'tool' | 'subagent';

/**
 * A capability contribution that was NOT merged because its id was already claimed. Mirrors the
 * `IPresetRegistrationResult` rejection shape (`resolve-preset.ts`) — a colliding contribution is
 * reported here, never silently overridden.
 */
export interface IRejectedCapability {
  kind: TCapabilityKind;
  id: string;
  reason: string;
}

/**
 * The pure result of {@link mergeCapabilityPacks}: the merged additive superset plus the rejection
 * channel. Mirrors `IPresetRegistrationResult` — the merger returns both the merged set AND every
 * collision, never a bare array.
 */
export interface IMergedCapabilities {
  merged: {
    commandModules: readonly ICommandModule[];
    tools: readonly FunctionTool[];
    subagents: readonly IAgentDefinition[];
  };
  rejected: readonly IRejectedCapability[];
}
