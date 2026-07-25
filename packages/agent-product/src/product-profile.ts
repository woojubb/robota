import type { ICapabilityPack, IRejectedCapability } from '@robota-sdk/agent-capability-pack';
import type { FunctionTool, IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  IBackgroundTaskRunner,
  ICommandModule,
  InteractiveSession,
  TInteractiveSessionOptions,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-framework';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';
import type { IPresetRegistry, IPreset, IResolvedPresetOptions } from '@robota-sdk/agent-preset';

/**
 * A declarative "this is my product" object — the sole argument of {@link assembleProduct}. Everything
 * product-specific lives here as DATA (identity, provider, presets, packs, injected plumbing); the
 * assembler hard-codes no product's choices. `robota` is one profile among many; an external repo brings
 * its own.
 *
 * The responsibility split (ARCH-005): **preset = behavior/persona**, **pack = capability**, **profile =
 * product assembly** — the profile carries neither behavior nor capability *definitions*, it only
 * *references* them and supplies identity + injected adapters.
 */
export interface IProductProfile {
  // (1) identity / branding
  /** Product id (diagnostics + surfaced on the assembled product). NEVER branched on by the assembler. */
  id: string;
  /** Product agent display name. */
  agentName?: string;
  /** Product version string. */
  version?: string;

  // (2) provider surface
  /**
   * The already-constructed provider (product-owned concrete I/O). The shell resolves settings/env/args
   * and constructs the provider, then injects it — keeping `assembleProduct` pure and IO-free (guard b).
   *
   * NOTE (ARCH-005 S1): the spec's directional sketch showed the provider "resolved from
   * providerDefinitions + settings" INSIDE `assembleProduct`. That would require a pure `config → provider`
   * factory at an allowed dependency layer; the only such factory (`createProviderFromConfig`) lives in
   * `agent-executor`, which is NOT an allowed dependency of `agent-product`, and re-exporting it would edit
   * the framework (which ARCH-005 keeps UNCHANGED). So S1 injects the constructed provider — faithful to
   * "concrete I/O stays product-owned" and to the shell already owning provider construction today
   * (`cli.ts`). Provider construction placement is settled in S2 when the shell is wired.
   */
  provider: IAIProvider;
  /** Provider definitions (data) — carried for the shell's own provider construction / hot-swap. */
  providerDefinitions?: readonly IProviderDefinition[];
  /** Active-provider override id (data). */
  providerOverride?: string;

  // (3) behavior axis — external presets to register + the default id
  /** External presets to register into a PER-CALL instance-scoped registry (R8). */
  presets?: readonly IPreset[];
  /** The default preset id, resolved to seed the assembled product's default posture. */
  defaultPresetId?: string;

  // (4) capability axis — additive packs + the product's own base command modules
  /** Additive capability packs (merged via `mergeCapabilityPacks`). */
  packs?: readonly ICapabilityPack[];
  /** The product's own base command modules (the packs merge on top of these). */
  baseCommandModules?: readonly ICommandModule[];

  // (5) injected runtime plumbing (concrete I/O stays product-owned — NOT hardcoded in agent-product)
  /** Background task runners the shell injects (from agent-executor, via the shell's composition root). */
  backgroundTaskRunners?: readonly IBackgroundTaskRunner[];
  /** Subagent runner factory the shell injects (concrete child-process / in-process runner). */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Transport registry VIEW (or a factory for one) — the read-only interface, never the concrete class. */
  transports?: ITransportRegistryView | (() => ITransportRegistryView);
}

/**
 * The shell-supplied input to {@link IAssembledProduct.buildRuntime}. The shell owns the session options
 * it resolves (cwd, provider, session store, memory, persona, permission mode, …); `assembleProduct`
 * overlays the product-owned assembled materials (command modules + pack tools) on top.
 */
export interface IBuildRuntimeInput {
  /**
   * The shell-resolved session options. `assembleProduct` overlays the assembled `commandModules` and pack
   * `additionalTools` and (when unset) the default preset's `permissionMode` before delegating to
   * `buildRuntimeSession`.
   */
  session: TInteractiveSessionOptions;
}

/**
 * The neutral runtime materials {@link assembleProduct} produces — everything the shell needs to bind its
 * own transport/presentation. Concrete transports, the TUI, and mode dispatch stay in the shell.
 */
export interface IAssembledProduct {
  /** Product identity (passthrough — surfaced for the shell, never branched on by the assembler). */
  id: string;
  agentName?: string;
  version?: string;

  /** The resolved provider (passthrough from the profile). */
  provider: IAIProvider;

  /** `baseCommandModules ⊕ merged pack modules` (see `mergeCapabilityPacks`). */
  commandModules: readonly ICommandModule[];
  /** Merged pack tools (additive). */
  tools: readonly FunctionTool[];
  /** Merged pack subagents (additive) — exposed as material; the shell wires the subagent-runner seam. */
  subagents: readonly IAgentDefinition[];
  /** Contributions the merge rejected for a colliding id (surfaced, never silently dropped). */
  rejectedCapabilities: readonly IRejectedCapability[];

  /** The per-call instance-scoped preset registry (R8 — no module-global mutation). */
  presets: IPresetRegistry;
  /** Convenience resolver bound over `presets` (equivalent to `presets.resolvePreset`). */
  resolvePreset: (id: string, context?: Parameters<IPresetRegistry['resolvePreset']>[1]) => IResolvedPresetOptions;
  /** The default preset id (passthrough) and its resolved posture, when a `defaultPresetId` was given. */
  defaultPresetId?: string;
  defaultPreset?: IResolvedPresetOptions;

  /** Injected plumbing (passthrough) the shell consumes when wiring the runtime. */
  backgroundTaskRunners: readonly IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  transports?: ITransportRegistryView;

  /**
   * Build the runtime session by DELEGATING to `agent-framework`'s `buildRuntimeSession` seam (R2) — never
   * a re-implementation. Overlays the assembled command modules + pack tools onto the shell-supplied
   * session options and returns the framework `InteractiveSession` the shell binds its presentation over.
   */
  buildRuntime: (input: IBuildRuntimeInput) => InteractiveSession;
}
