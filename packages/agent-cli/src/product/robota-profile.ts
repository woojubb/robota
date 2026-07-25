/**
 * ARCH-005 S2 — `robota`, expressed as an `IProductProfile`.
 *
 * This file IS robota's product identity. Everything that used to be hand-wired into `startCli`'s
 * composition root — which providers it offers, which presets it carries, which capability packs it
 * composes, which base command modules it starts from, and which concrete plumbing it injects — is
 * declared here as DATA and folded by the product-neutral `assembleProduct`. `robota` is one profile
 * among many; an external repo brings its own and reuses the same kernel.
 *
 * What stays OUTSIDE this file (in `cli.ts`, the product SHELL): arg parsing, settings/env/file reads,
 * terminal notices, first-run/`init`/`--configure`/`ensureConfig`, memory + session-resume UX, and
 * print/serve/TUI mode dispatch. Those produce the already-resolved DATA this profile carries; the fold
 * itself performs no IO.
 */

import { createCodingPack } from '@robota-sdk/pack-coding';

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

/** The product id. Data only — `assembleProduct` never branches on it (composition-neutrality guard c). */
const ROBOTA_PRODUCT_ID = 'robota';

/**
 * The capability packs `robota` composes. Removing one genuinely removes its capability from the product —
 * its command modules, its subagents AND (since ARCH-006) its tools, because the profile hands the packs
 * the whole tool surface (see {@link ROBOTA_PACKS_OWN_TOOL_SURFACE}).
 *
 * A FACTORY over the session context, not a constant: `pack-coding`'s file tools are scoped to the `cwd`
 * they are built with, and a context-free pack would carry a disarmed working-directory path guard.
 */
export function createRobotaPacks(context: ICodingPackOptions): readonly TCapabilityPack[] {
  return [createCodingPack(context)];
}

/**
 * ARCH-006: `robota`'s packs OWN its tool surface. The shell passes this as the session's `defaultTools`,
 * which REPLACES `agent-framework`'s `createDefaultTools()` tier — so every tool robota runs comes from a
 * pack, and dropping a pack drops its tools from the product. Exported as the single named declaration of
 * that decision rather than an anonymous `[]` at the call site.
 */
export const ROBOTA_PACKS_OWN_TOOL_SURFACE: readonly never[] = [];

/** Command-module names the given packs supply, so the shell can exclude them from the base set it builds. */
export function packCommandModuleNames(packs: readonly TCapabilityPack[]): readonly string[] {
  return packs.flatMap((pack) => pack.commandModules?.map((cmd) => cmd.name) ?? []);
}

/** The already-resolved shell inputs `robota`'s profile is built from. */
export interface IRobotaProfileInput {
  /** CLI version string (read from package.json by the shell). */
  version: string;
  /** Resolved agent display name (preset value, else agent-preset's `DEFAULT_AGENT_NAME`). */
  agentName: string;
  /** The provider definitions `robota` offers. */
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
  /** The capability packs the shell built from `createRobotaPacks` with its resolved session context. */
  packs: readonly TCapabilityPack[];
}

/** Build `robota`'s product profile from the shell's already-resolved inputs. Pure. */
export function createRobotaProfile(input: IRobotaProfileInput): IProductProfile {
  return {
    id: ROBOTA_PRODUCT_ID,
    agentName: input.agentName,
    version: input.version,
    providerDefinitions: input.providerDefinitions,
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
