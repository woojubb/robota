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

import { codingPack } from '@robota-sdk/pack-coding';

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
import type { IPreset } from '@robota-sdk/agent-preset';
import type { IProductProfile } from '@robota-sdk/agent-product';

/** The product id. Data only — `assembleProduct` never branches on it (composition-neutrality guard c). */
const ROBOTA_PRODUCT_ID = 'robota';

/** The capability packs `robota` composes. Removing one genuinely removes its capability from the product. */
const ROBOTA_PACKS = [codingPack] as const;

/** Command-module names the packs supply, so the shell can exclude them from the base set it builds. */
export const ROBOTA_PACK_COMMAND_MODULE_NAMES: readonly string[] = ROBOTA_PACKS.flatMap(
  (pack) => pack.commandModules?.map((module) => module.name) ?? [],
);

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
  /** User-authored external presets the shell loaded from disk (`~/.robota/presets/*.json`). */
  presets: readonly IPreset[];
  /** The preset id selected for this run (`--preset` > `settings.preset` > `'default'`). */
  defaultPresetId: string;
  /** The base command modules (defaults minus the pack-supplied ones); packs merge on top. */
  baseCommandModules: readonly ICommandModule[];
  /** Concrete background-task runners the shell injects. */
  backgroundTaskRunners: readonly IBackgroundTaskRunner[];
  /** Concrete child-process subagent runner factory the shell injects. */
  subagentRunnerFactory: TSubagentRunnerFactory;
  /** The transport registry the shell owns (concrete `WsTransport` registered), passed as a read-only view. */
  transports: ITransportRegistryView;
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
    presets: input.presets,
    defaultPresetId: input.defaultPresetId,
    packs: [...ROBOTA_PACKS],
    baseCommandModules: input.baseCommandModules,
    backgroundTaskRunners: input.backgroundTaskRunners,
    subagentRunnerFactory: input.subagentRunnerFactory,
    transports: input.transports,
  };
}
