import { findUnknownModuleNames, selectCommandModules } from '@robota-sdk/agent-framework';

import { createAgentCommandModule } from '../agent/index.js';
import { createBackgroundCommandModule } from '../background/index.js';
import { createCompactCommandModule } from '../compact/index.js';
import { createContextCommandModule } from '../context/index.js';
import { createDoctorCommandModule } from '../doctor/index.js';
import { createEditorCommandModule } from '../editor/index.js';
import { createAdvisorCommandModule } from '../advisor/index.js';
import { createEffortCommandModule } from '../effort/index.js';
import { createExitCommandModule } from '../exit/index.js';
import { createForkCommandModule } from '../fork/index.js';
import { createGitCommandModule } from '../git/index.js';
import { createGoalCommandModule } from '../goal/index.js';
import { createHandoffCommandModule } from '../handoff/index.js';
import { createHelpCommandModule } from '../help/index.js';
import { createKeybindingsCommandModule } from '../keybindings/index.js';
import { createLanguageCommandModule } from '../language/index.js';
import { createMCPActivationCommandModule } from '../mcp-activation/index.js';
import { createMemoryCommandModule } from '../memory/index.js';
import { createModeCommandModule } from '../mode/index.js';
import { createSandboxCommandModule } from '../sandbox/index.js';
import { createOutputStyleCommandModule } from '../output-style/index.js';
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
import { createShellCommandModule } from '../shell/index.js';
import { createSkillsCommandModule } from '../skills/index.js';
import { createStatusLineCommandModule } from '../statusline/index.js';
import { createThemeCommandModule } from '../theme/index.js';
import { createUserLocalCommandModule } from '../user-local/index.js';

import type { IDoctorDisplayVocabulary, IDoctorInputs } from '../doctor/index.js';
import type { IKeybindingsFilePort } from '../keybindings/index.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IOrgPolicy,
  IContributionSource,
  ISkillRootDescriptor,
  ICommandModule,
  IProviderCommandSettingsAdapter,
  IUnknownCommandModuleName,
} from '@robota-sdk/agent-framework';
import type { IThemeCataloguePort } from '@robota-sdk/agent-interface-command';

export interface IDefaultCommandModulesOptions {
  cwd: string;
  userLocalStorageRoot: string;
  /** Product-owned prefix for the interactive editor's temporary directory. */
  editorTemporaryDirectoryPrefix?: string;
  contributionSources?: readonly IContributionSource[];
  skillRoots?: readonly ISkillRootDescriptor[];
  providerDefinitions: readonly IProviderDefinition[];
  providerSettingsAdapter: IProviderCommandSettingsAdapter;
  /**
   * CLI-083 (issue #2287) — the org policy, so `allowedProviders` and `requireApiKeyFromEnv` are
   * reachable. This parameter existed, was removed by `92596bc6f` along with its only caller, and
   * the consumer never stopped reading it: `provider-command-profile-operations.ts` still
   * destructures `orgPolicy` from its options and enforces on it. Optional, so its absence stays
   * distinguishable from a policy that allows everything — and that optionality is why nothing went
   * red when the producer dropped it.
   */
  orgPolicy?: IOrgPolicy;
  /** Optional TUI-owned file capability; absence means `/keybindings` is not registered. */
  keybindingsFilePort?: IKeybindingsFilePort;
  /**
   * SCREEN-2002: the surface's theme catalogue. Absence means `/theme` is not registered at all —
   * print mode and `--serve` render no themes, and a command that cannot do anything is better
   * missing than present-and-failing.
   */
  themeCataloguePort?: IThemeCataloguePort;
  /** OBSERVABILITY-1991: host-composed doctor inputs; absence means `/doctor` is not registered. */
  doctorInputs?: IDoctorInputs;
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
 * INFRA-032: delegates to agent-framework's `selectCommandModules` (the allowed command→framework
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
 * Result of {@link createDefaultCommandModules} (INFRA-032): the selected `modules` plus any preset
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
  editorTemporaryDirectoryPrefix,
  contributionSources,
  skillRoots,
  providerDefinitions,
  providerSettingsAdapter,
  orgPolicy,
  keybindingsFilePort,
  themeCataloguePort,
  doctorInputs,
  doctorDisplay,
  formatForkResumeCommand,
  loopOptions,
  enabledCommandModules,
  disabledCommandModules,
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
    // CLI-1994: beside `/background`, because a fork IS a background job — the one it starts is
    // listed, peeked at, stopped and attached to through that command and its panel.
    createForkCommandModule(formatForkResumeCommand),
    createGoalCommandModule(),
    createPlanCommandModule(),
    createShellCommandModule(),
    createEditorCommandModule(editorTemporaryDirectoryPrefix),
    createGitCommandModule(),
    ...(keybindingsFilePort === undefined
      ? []
      : [createKeybindingsCommandModule(keybindingsFilePort)]),
    ...(themeCataloguePort === undefined ? [] : [createThemeCommandModule(themeCataloguePort)]),
    ...(doctorInputs === undefined
      ? []
      : [createDoctorCommandModule(doctorInputs, undefined, doctorDisplay)]),
    createMemoryCommandModule(),
    createMCPActivationCommandModule(),
    createUserLocalCommandModule(userLocalStorageRoot),
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
    // HANDOFF-001 (issue #1864). Registered even though no product wires the carrier adapter yet:
    // the command's own answer to a host without one is to say so, which is a better state than a
    // capability nobody can see. It is also what makes the carrier's arrival observable.
    createHandoffCommandModule(),
    createRemoteControlCommandModule(),
    createProviderCommandModule({
      providerDefinitions,
      settings: providerSettingsAdapter,
      ...(orgPolicy === undefined ? {} : { orgPolicy }),
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
