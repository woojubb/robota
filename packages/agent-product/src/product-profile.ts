import type { ICapabilityPack, IRejectedCapability } from '@robota-sdk/agent-capability-pack';
import type {
  FunctionTool,
  IAIProvider,
  IProviderDefinition,
  IProviderDefinitionConfig,
} from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  IBackgroundTaskRunner,
  ICommandModule,
  InteractiveSession,
  TInteractiveSessionOptions,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-framework';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';
import type {
  IPresetRegistry,
  IPreset,
  IResolvePresetContext,
  IResolvedPresetOptions,
} from '@robota-sdk/agent-preset';

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

  // (2) provider surface — construction is IN-KERNEL (ARCH-005 S2, owner Decision 1)
  /**
   * The product's provider surface: the vendor definitions it offers. Required — a product declares which
   * providers it can speak to, and the kernel constructs from this registry. Pass `[]` for a product that
   * only ever runs on an injected {@link provider}.
   */
  providerDefinitions: readonly IProviderDefinition[];
  /**
   * The ALREADY-RESOLVED provider configuration (name/model/apiKey/baseURL/…). The SHELL performs the
   * settings/env/file reads that produce this value and passes it IN as plain data; the kernel then
   * constructs the provider from it via `createProviderFromConfig`. That keeps the fold pure and IO-free
   * (guard b) while returning provider construction to the kernel, per the spec's In-kernel boundary
   * ("Provider construction FROM `IProviderDefinition[]` + already-resolved settings → In-kernel").
   *
   * Absent ⇒ no provider is constructed; the consumer either injects {@link provider} or supplies one at
   * `buildRuntime` time (the Mode A shape, which carries only `providerDefinitions`).
   */
  providerSettings?: IProviderDefinitionConfig;
  /**
   * OPTIONAL injected provider override for advanced/test consumers — a pre-built provider that takes
   * precedence over {@link providerSettings}. `robota` uses it for `--session-log` replay, where the
   * provider answers from a recorded log instead of a vendor definition.
   */
  provider?: IAIProvider;
  /** Active-provider override id (data). */
  providerOverride?: string;

  // (3) behavior axis — external presets to register + the default id
  /**
   * External presets to register into a PER-CALL instance-scoped registry (R8). Ignored when
   * {@link presetRegistry} is supplied — that registry is then used as-is.
   */
  presets?: readonly IPreset[];
  /**
   * An ALREADY-BUILT instance-scoped registry (from `agent-preset`'s `createPresetRegistry`) to use
   * instead of building one from {@link presets}. When supplied it WINS over `presets`.
   *
   * This is the seam for a shell that must resolve a preset BEFORE it can build the profile — a preset
   * can carry the `model` and `agentName` the profile itself is constructed from, so "resolve, then
   * assemble" is a real ordering constraint, not a robota quirk. Handing the registry in (rather than the
   * presets) is what keeps that pre-assembly resolution and `assembleProduct`'s own resolution on ONE
   * registry instead of two equivalent-but-separate ones (ARCH-008). R8 is unaffected: the registry is
   * still instance-scoped and no module-level state is read or mutated.
   */
  presetRegistry?: IPresetRegistry;
  /** The default preset id, resolved to seed the assembled product's default posture. */
  defaultPresetId?: string;
  /**
   * The override layers applied when resolving {@link defaultPresetId} (`cliOverrides` / `explicit`).
   * A shell that resolved the same id with overrides passes the SAME context here, so
   * {@link IAssembledProduct.defaultPreset} is the shell's resolution, not a half-resolved variant of it.
   */
  presetContext?: IResolvePresetContext;

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

  /**
   * The provider the kernel constructed from `providerDefinitions` + `providerSettings` — or the injected
   * `profile.provider` when one was supplied (it wins). `undefined` when the profile carried neither
   * (Mode A): the consumer then supplies a provider in the `buildRuntime` session options.
   */
  provider?: IAIProvider;
  /** The product's provider surface (passthrough) — the definitions hot-swap and setup flows read. */
  providerDefinitions: readonly IProviderDefinition[];

  /** `baseCommandModules ⊕ merged pack modules` (see `mergeCapabilityPacks`). */
  commandModules: readonly ICommandModule[];
  /** Merged pack tools (additive). */
  tools: readonly FunctionTool[];
  /** Merged pack subagents (additive) — exposed as material; the shell wires the subagent-runner seam. */
  subagents: readonly IAgentDefinition[];
  /** Contributions the merge rejected for a colliding id (surfaced, never silently dropped). */
  rejectedCapabilities: readonly IRejectedCapability[];

  /**
   * The per-call instance-scoped preset registry (R8 — no module-global mutation). This is the SAME
   * object the profile supplied as `presetRegistry`, when it supplied one.
   */
  presets: IPresetRegistry;
  /** Convenience resolver bound over `presets` (equivalent to `presets.resolvePreset`). */
  resolvePreset: (
    id: string,
    context?: Parameters<IPresetRegistry['resolvePreset']>[1],
  ) => IResolvedPresetOptions;
  /**
   * The default preset id (passthrough) and its resolved posture — resolved over {@link presets} with the
   * profile's `presetContext`, so a shell that resolved the same id with the same overrides gets the same
   * value here (ARCH-008), not a variant missing its override layers.
   */
  defaultPresetId?: string;
  defaultPreset?: IResolvedPresetOptions;

  /** Injected plumbing (passthrough) the shell consumes when wiring the runtime. */
  backgroundTaskRunners: readonly IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  transports?: ITransportRegistryView;

  /**
   * The PURE overlay `buildRuntime` delegates through: the shell-supplied session options with the
   * product-owned materials laid on top (assembled command modules, pack tools, pack subagents as
   * `agentDefinitions`, the constructed provider, and the default preset's `permissionMode` when the shell
   * left it unset). Exposed so a consumer can inspect or further extend the options before construction —
   * and so the overlay contract is assertable without building a live session.
   */
  buildRuntimeOptions: (input: IBuildRuntimeInput) => TInteractiveSessionOptions;

  /**
   * Build the runtime session by DELEGATING to `agent-framework`'s `buildRuntimeSession` seam (R2) — never
   * a re-implementation. Equivalent to `buildRuntimeSession(buildRuntimeOptions(input))`; returns the
   * framework `InteractiveSession` the shell binds its presentation over.
   */
  buildRuntime: (input: IBuildRuntimeInput) => InteractiveSession;
}
