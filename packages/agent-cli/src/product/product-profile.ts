import { createCodingPack } from '@robota-sdk/pack-coding';
import type { ICliRuntimeContext } from './runtime-context.js';

import type {
  IAIProvider,
  IProviderDefinition,
  IProviderDefinitionConfig,
} from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandModule,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-framework';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';
import type { IProductProfile } from '@robota-sdk/agent-product';
import type { IShellPresetResolution } from '../startup/preset-selection.js';
import type { ICodingPackOptions } from '@robota-sdk/pack-coding';

/**
 * A capability pack, reached through the kernel's own profile contract rather than a direct dependency on
 * `@robota-sdk/agent-capability-pack` — the shell composes packs, it does not author the pack contract.
 */
type TCapabilityPack = NonNullable<IProductProfile['packs']>[number];

/**
 * The capability packs `the product` composes. Removing one genuinely removes its capability from the product —
 * its command modules, its subagents AND (since ARCH-006) its tools, because the profile hands the packs
 * the whole tool surface (see {@link PACKS_OWN_TOOL_SURFACE}).
 *
 * A FACTORY over the session context, not a constant: `pack-coding`'s file tools are scoped to the `cwd`
 * they are built with, and a context-free pack would carry a disarmed working-directory path guard.
 */
export function createProductCapabilityPacks(context: ICodingPackOptions, runtime: ICliRuntimeContext): readonly TCapabilityPack[] {
  return [
    createCodingPack({
      ...context,
      editorTemporaryDirectoryPrefix: runtime.vocabulary.editorTemporaryDirectoryPrefix,
      httpUserAgent: runtime.config.identity.cliName,
    }),
  ];
}

/**
 * ARCH-006: `the product`'s packs OWN its tool surface. The shell passes this as the session's `defaultTools`,
 * which REPLACES `agent-framework`'s `createDefaultTools()` tier — so every tool the product runs comes from a
 * pack, and dropping a pack drops its tools from the product. Exported as the single named declaration of
 * that decision rather than an anonymous `[]` at the call site.
 */
export const PACKS_OWN_TOOL_SURFACE: readonly never[] = [];

/** Command-module names the given packs supply, so the shell can exclude them from the base set it builds. */
export function packCommandModuleNames(packs: readonly TCapabilityPack[]): readonly string[] {
  return packs.flatMap((pack) => pack.commandModules?.map((cmd) => cmd.name) ?? []);
}

/** The already-resolved shell inputs `the product`'s profile is built from. */
export interface IProductProfileInput {
  productRuntime: ICliRuntimeContext;
  /** CLI version string (read from package.json by the shell). */
  version: string;
  /** Resolved agent display name (preset value, else The product's product default). */
  agentName: string;
  /** The provider definitions `the product` offers. */
  providerDefinitions: readonly IProviderDefinition[];
  /** Provider configuration the shell already resolved from settings/env; the kernel constructs from it. */
  providerSettings?: IProviderDefinitionConfig;
  /** Pre-built provider that overrides `providerSettings` — `--session-log` replay uses this. */
  provider?: IAIProvider;
  /**
   * The shell's single preset resolution (ARCH-008) — the per-call registry it ran over, the selected id,
   * and the override context. Taken as ONE value so the profile cannot carry a registry/id/context other
   * than the ones the shell actually resolved with; `assembleProduct` adopts the same registry and replays
   * the same context, so `product.defaultPreset` IS `preset.options`.
   */
  preset: IShellPresetResolution;
  /** The base command modules (defaults minus the pack-supplied ones); packs merge on top. */
  baseCommandModules: readonly ICommandModule[];
  /** Concrete background-task runners the shell injects. */
  backgroundTaskRunners: readonly IBackgroundTaskRunner[];
  /** Concrete child-process subagent runner factory the shell injects. */
  subagentRunnerFactory: TSubagentRunnerFactory;
  /** The transport registry the shell owns (concrete `WsTransport` registered), passed as a read-only view. */
  transports: ITransportRegistryView;
  /** The capability packs the shell built from `createProductCapabilityPacks` with its resolved session context. */
  packs: readonly TCapabilityPack[];
}

/** Build `the product`'s product profile from the shell's already-resolved inputs. Pure. */
export function createSelectedProductProfile(input: IProductProfileInput): IProductProfile {
  return {
    id: input.productRuntime.config.identity.id,
    agentName: input.agentName,
    version: input.version,
    providerDefinitions: input.providerDefinitions,
    promptFileReferenceTag: input.productRuntime.config.identity.promptFileReferenceTag,
    modelCommandToolPrefix: input.productRuntime.config.identity.modelCommandToolPrefix,
    subagentHookEnvironmentNames: { agentId: `${input.productRuntime.config.identity.envPrefix}AGENT_ID`, agentType: `${input.productRuntime.config.identity.envPrefix}AGENT_TYPE` },
    observerFailureWarningCode: `${input.productRuntime.config.identity.envPrefix}BACKGROUND_OBSERVER_FAILURE`,
    providerErrorGuidance: {
      authentication:
        `Run /provider to reconfigure, or check ${input.productRuntime.layout.userPaths.settings}.`,
      forbidden: 'Run `/provider` to switch accounts.',
      rateLimit: 'Consider switching to a different model with `/provider`.',
      network: `Verify your provider URL in ${input.productRuntime.layout.userPaths.settings}.`,
      modelUnavailable: 'Run `/provider` to pick a model this key can use.',
    },
    ...(input.providerSettings !== undefined ? { providerSettings: input.providerSettings } : {}),
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    presetRegistry: input.preset.registry,
    presetContext: input.preset.context,
    defaultPresetId: input.preset.presetId,
    packs: input.packs,
    baseCommandModules: input.baseCommandModules,
    backgroundTaskRunners: input.backgroundTaskRunners,
    subagentRunnerFactory: input.subagentRunnerFactory,
    transports: input.transports,
  };
}
