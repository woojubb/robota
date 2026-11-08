import { findUnknownModuleNames, selectCommandModules } from '@robota-sdk/agent-framework';

import { createAgentCommandModule } from '../agent/index.js';
import { createBackgroundCommandModule } from '../background/index.js';
import { createCompactCommandModule } from '../compact/index.js';
import { createContextCommandModule } from '../context/index.js';
import { createDevicesCommandModule } from '../devices/index.js';
import { createDoctorCommandModule } from '../doctor/index.js';
import { createAdvisorCommandModule } from '../advisor/index.js';
import { createEffortCommandModule } from '../effort/index.js';
import { createExitCommandModule } from '../exit/index.js';
import { createForkCommandModule } from '../fork/index.js';
import { createGitCommandModule } from '../git/index.js';
import { createGoalCommandModule } from '../goal/index.js';
import { createHandoffCommandModule } from '../handoff/index.js';
import { createHelpCommandModule } from '../help/index.js';
import { createKeyCustodyCommandModule } from '../key-custody/index.js';
import { createKeybindingsCommandModule } from '../keybindings/index.js';
import { createLanguageCommandModule } from '../language/index.js';
import { createMCPActivationCommandModule } from '../mcp-activation/index.js';
import { createMemoryCommandModule } from '../memory/index.js';
import { createModeCommandModule } from '../mode/index.js';
import { createModelCommandModule } from '../model/index.js';
import { createSandboxCommandModule } from '../sandbox/index.js';
import { createOutputStyleCommandModule } from '../output-style/index.js';
import { createEventsCommandModule } from '../events/index.js';
import { createPeersCommandModule } from '../peers/index.js';
import { createPermissionsCommandModule } from '../permissions/index.js';
import { createPlanCommandModule } from '../plan/index.js';
import { createPluginCommandModule } from '../plugin/index.js';
import { createPresetCommandModule } from '../preset/index.js';
import { createProviderCommandModule } from '../provider/index.js';
import { createRemoteControlCommandModule } from '../remote-control/index.js';
import { createResetCommandModule } from '../reset/index.js';
import { createRewindCommandModule } from '../rewind/index.js';
import { createScheduleCommandModule } from '../schedule/index.js';
import { createSessionCommandModule } from '../session/index.js';
import { createSettingsCommandModule } from '../settings/index.js';
import { createSkillsCommandModule } from '../skills/index.js';
import { createStatusLineCommandModule } from '../statusline/index.js';
import { createThemeCommandModule } from '../theme/index.js';
import { createUserLocalCommandModule } from '../user-local/index.js';

import type { IDevicesCommandPort } from '../devices/index.js';
import type { IDoctorDeps, IDoctorDisplayVocabulary, IDoctorInputs } from '../doctor/index.js';
import type { IKeyCustodyCommandPort } from '../key-custody/index.js';
import type { IKeybindingsFilePort, TOpenFileInEditor } from '../keybindings/index.js';
import type {
  IFileSystemAsync,
  IProviderDefinition,
  TProviderCredentialResolver,
} from '@robota-sdk/agent-core';
import type {
  IOrgPolicy,
  IContributionSource,
  IGitProcessPort,
  ISkillRootDescriptor,
  ICommandModule,
  IProviderCommandSettingsAdapter,
  IProviderConnectionHost,
  IUnknownCommandModuleName,
  TProviderEnvironment,
} from '@robota-sdk/agent-framework';
import type { IThemeCataloguePort } from '@robota-sdk/agent-interface-command';

export interface IDefaultCommandModulesOptions {
  cwd: string;
  userLocalStorageRoot: string;
  /**
   * The files `/user-local` reads and writes its storage root through; a Node host passes
   * `new NodeFileSystemAsync()` from `@robota-sdk/agent-framework/node`. Absent, `/user-local` is
   * registered and says it is unavailable on this host.
   */
  userLocalFileSystem?: IFileSystemAsync;
  contributionSources?: readonly IContributionSource[];
  skillRoots?: readonly ISkillRootDescriptor[];
  providerDefinitions: readonly IProviderDefinition[];
  providerSettingsAdapter: IProviderCommandSettingsAdapter;
  /**
   * The org policy, so `allowedProviders` and `requireApiKeyFromEnv` are
   * reachable. This parameter existed, was removed by `92596bc6f` along with its only caller, and
   * the consumer never stopped reading it: `provider-command-profile-operations.ts` still
   * destructures `orgPolicy` from its options and enforces on it. Optional, so its absence stays
   * distinguishable from a policy that allows everything — and that optionality is why nothing went
   * red when the producer dropped it.
   */
  orgPolicy?: IOrgPolicy;
  /**
   * Where `/provider` and `/model` check a `$ENV:` or default credential variable: the host's startup
   * snapshot (a map) when it withholds its own credentials from `process.env`, or a resolver such as
   * `host.env`. Absent, every reference reads as unset: the commands do not read `process.env`.
   */
  providerEnvironment?: TProviderEnvironment;
  /** Host-owned connection acquisition and transactional credential persistence. */
  providerConnectionHost?: IProviderConnectionHost;
  /** Host-owned resolution of an opaque saved credential reference. */
  providerCredentialResolver?: TProviderCredentialResolver;
  missingEnvironmentCredentialHint?: (profileName: string, environmentName: string) => string;
  /** Optional TUI-owned file capability; absent, `/keybindings` says it belongs to an interactive terminal. */
  keybindingsFilePort?: IKeybindingsFilePort;
  /**
   * How `/keybindings` opens that file in the user's editor; a Node host passes `openFileInEditor`
   * from `@robota-sdk/agent-product/command/node`. Absent, `/keybindings` says it cannot open an editor here.
   */
  keybindingsEditor?: TOpenFileInEditor;
  /**
   * The surface's theme catalogue. Absent (print mode, `--serve`), `/theme` is still
   * listed and says it belongs to an interactive terminal, which runs it when attached.
   */
  themeCataloguePort?: IThemeCataloguePort;
  /**
   * The host that keeps this device's identity (its terminal, credential store and state files).
   * Absence means `/devices` is not registered: without it the command could do nothing.
   */
  devicesPort?: IDevicesCommandPort;
  /**
   * The process's hold on the keys of secure conversations. Absence means `/unlock` and `/lock` are
   * not registered: a process with secure mode off, or with no terminal to read a passphrase on, has
   * no keys for them to open or drop.
   */
  keyCustodyPort?: IKeyCustodyCommandPort;
  /**
   * The process `/git` runs git through; a Node host passes `createGitProcess()` from
   * `@robota-sdk/agent-framework/node`. Absent, `/git` is registered and says it is unavailable on this host.
   */
  gitProcess?: IGitProcessPort;
  /** host-composed doctor inputs; absence means `/doctor` is not registered. */
  doctorInputs?: IDoctorInputs;
  /**
   * The probes and writers `/doctor` runs through; a Node host passes `createNodeDoctorDeps` from
   * `@robota-sdk/agent-product/command/node`. Absent, `/doctor` is registered and says it is unavailable.
   */
  doctorDeps?: IDoctorDeps;
  /** Product-owned diagnostic wording; absent keeps `/doctor` product-neutral. */
  doctorDisplay?: IDoctorDisplayVocabulary;
  /** Product-owned command to resume a saved fork; absent yields neutral host guidance. */
  formatForkResumeCommand?: (sessionId: string) => string;
  /** Host-owned fallback text and kill switch for session-local repeat. */
  loopOptions?: { defaultPrompt?: string; resolveDefaultPrompt?: () => string; disabled?: boolean };
  /**
   * Whitelist of module `name`s to keep. When provided, only modules whose `name`
   * appears here survive. Omitted → all modules kept (no-regression).
   */
  enabledCommandModules?: readonly string[];
  /**
   * Blacklist of module `name`s to remove. Applied after the whitelist, so a name
   * present in both is removed (deny > allow). Omitted → no modules removed.
   */
  disabledCommandModules?: readonly string[];
}

/**
 * Apply the preset module-selection delta to the default module set.
 *
 * Rules: if `enabled` is provided, keep only modules whose `name` is in it; then
 * remove any module whose `name` is in `disabled` (deny > allow). Neither given →
 * the full default set is returned unchanged (no-regression).
 *
 * Delegates to agent-framework's `selectCommandModules` (the allowed command→framework
 * edge) so the filter body exists once — the previously byte-identical copy here is collapsed.
 */
function applyModuleSelection(
  modules: readonly ICommandModule[],
  enabled: readonly string[] | undefined,
  disabled: readonly string[] | undefined,
): readonly ICommandModule[] {
  return selectCommandModules(modules, enabled, disabled);
}

/**
 * Result of {@link createDefaultCommandModules}: the selected `modules` plus any preset
 * `enabledCommandModules`/`disabledCommandModules` names that matched no built module. Unknown names
 * are returned as data (not dropped silently) so the CLI startup path can surface a non-fatal notice.
 */
export interface IDefaultCommandModulesResult {
  readonly modules: readonly ICommandModule[];
  readonly unknownModuleNames: readonly IUnknownCommandModuleName[];
}

export function createDefaultCommandModules({
  cwd: _cwd,
  userLocalStorageRoot,
  userLocalFileSystem,
  contributionSources,
  skillRoots,
  providerDefinitions,
  providerSettingsAdapter,
  orgPolicy,
  keybindingsFilePort,
  keybindingsEditor,
  themeCataloguePort,
  devicesPort,
  keyCustodyPort,
  doctorInputs,
  doctorDeps,
  doctorDisplay,
  gitProcess,
  formatForkResumeCommand,
  loopOptions,
  enabledCommandModules,
  disabledCommandModules,
  providerEnvironment,
  providerConnectionHost,
  providerCredentialResolver,
  missingEnvironmentCredentialHint,
}: IDefaultCommandModulesOptions): IDefaultCommandModulesResult {
  const modules: readonly ICommandModule[] = [
    createSkillsCommandModule({ contributionSources: contributionSources ?? [], skillRoots }),
    createHelpCommandModule(),
    createAgentCommandModule(),
    createEffortCommandModule(),
    createAdvisorCommandModule(),
    createPermissionsCommandModule(),
    createModeCommandModule(),
    createSandboxCommandModule(),
    createPresetCommandModule(),
    createOutputStyleCommandModule(),
    createLanguageCommandModule(),
    createBackgroundCommandModule(),
    // Beside `/background`, because a fork IS a background job — the one it starts is
    // listed, peeked at, stopped and attached to through that command and its panel.
    createForkCommandModule(formatForkResumeCommand),
    createGoalCommandModule(),
    createPlanCommandModule(),
    createGitCommandModule({ port: gitProcess }),
    createKeybindingsCommandModule(keybindingsFilePort, keybindingsEditor),
    createThemeCommandModule(themeCataloguePort),
    ...(doctorInputs === undefined
      ? []
      : [createDoctorCommandModule(doctorInputs, doctorDeps, doctorDisplay)]),
    createMemoryCommandModule(),
    createMCPActivationCommandModule(),
    createUserLocalCommandModule(userLocalStorageRoot, userLocalFileSystem),
    createCompactCommandModule(),
    createContextCommandModule(),
    createExitCommandModule(),
    createSessionCommandModule(),
    createResetCommandModule(),
    createRewindCommandModule(),
    createScheduleCommandModule(loopOptions),
    createStatusLineCommandModule(),
    createPluginCommandModule(),
    createSettingsCommandModule(),
    createPeersCommandModule(),
    createEventsCommandModule(),
    // Registered even though no product wires the carrier adapter yet:
    // the command's own answer to a host without one is to say so, which is a better state than a
    // capability nobody can see. It is also what makes the carrier's arrival observable.
    createHandoffCommandModule(),
    createRemoteControlCommandModule(),
    ...(devicesPort === undefined ? [] : [createDevicesCommandModule(devicesPort)]),
    ...(keyCustodyPort === undefined ? [] : [createKeyCustodyCommandModule(keyCustodyPort)]),
    createProviderCommandModule({
      providerDefinitions,
      settings: providerSettingsAdapter,
      ...(orgPolicy === undefined ? {} : { orgPolicy }),
      ...(providerEnvironment === undefined ? {} : { env: providerEnvironment }),
      ...(providerConnectionHost === undefined ? {} : { connectionHost: providerConnectionHost }),
      ...(providerCredentialResolver === undefined
        ? {}
        : { resolveCredential: providerCredentialResolver }),
      ...(missingEnvironmentCredentialHint === undefined ? {} : { missingEnvironmentCredentialHint }),
    }),
    // Shares the provider command's settings adapter and definitions — one settings write
    // owner, never a second copy that could drift from what `/provider switch` reads and writes.
    createModelCommandModule({
      providerDefinitions,
      settings: providerSettingsAdapter,
      ...(orgPolicy === undefined ? {} : { orgPolicy }),
      ...(providerEnvironment === undefined ? {} : { env: providerEnvironment }),
      ...(providerCredentialResolver === undefined
        ? {}
        : { resolveCredential: providerCredentialResolver }),
      ...(missingEnvironmentCredentialHint === undefined ? {} : { missingEnvironmentCredentialHint }),
    }),
  ];
  const builtModuleNames = modules.map((module) => module.name);
  return {
    modules: applyModuleSelection(modules, enabledCommandModules, disabledCommandModules),
    unknownModuleNames: findUnknownModuleNames(
      builtModuleNames,
      enabledCommandModules,
      disabledCommandModules,
    ),
  };
}
