import { findUnknownModuleNames, selectCommandModules } from '@robota-sdk/agent-framework';

import { createAgentCommandModule } from '../agent/index.js';
import { createBackgroundCommandModule } from '../background/index.js';
import { createCompactCommandModule } from '../compact/index.js';
import { createContextCommandModule } from '../context/index.js';
import { createEditorCommandModule } from '../editor/index.js';
import { createExitCommandModule } from '../exit/index.js';
import { createGoalCommandModule } from '../goal/index.js';
import { createHelpCommandModule } from '../help/index.js';
import { createLanguageCommandModule } from '../language/index.js';
import { createMemoryCommandModule } from '../memory/index.js';
import { createModeCommandModule } from '../mode/index.js';
import { createPermissionsCommandModule } from '../permissions/index.js';
import { createPluginCommandModule } from '../plugin/index.js';
import { createPresetCommandModule } from '../preset/index.js';
import { createProviderCommandModule } from '../provider/index.js';
import { createResetCommandModule } from '../reset/index.js';
import { createRewindCommandModule } from '../rewind/index.js';
import { createScheduleCommandModule } from '../schedule/index.js';
import { createSessionCommandModule } from '../session/index.js';
import { createSettingsCommandModule } from '../settings/index.js';
import { createShellCommandModule } from '../shell/index.js';
import { createSkillsCommandModule } from '../skills/index.js';
import { createStatusLineCommandModule } from '../statusline/index.js';
import { createUserLocalCommandModule } from '../user-local/index.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  ICommandModule,
  IProviderCommandSettingsAdapter,
  IUnknownCommandModuleName,
} from '@robota-sdk/agent-framework';

export interface IDefaultCommandModulesOptions {
  cwd: string;
  providerDefinitions: readonly IProviderDefinition[];
  providerSettingsAdapter: IProviderCommandSettingsAdapter;
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
  cwd,
  providerDefinitions,
  providerSettingsAdapter,
  enabledCommandModules,
  disabledCommandModules,
}: IDefaultCommandModulesOptions): IDefaultCommandModulesResult {
  const modules: readonly ICommandModule[] = [
    createSkillsCommandModule({ cwd }),
    createHelpCommandModule(),
    createAgentCommandModule(),
    createPermissionsCommandModule(),
    createModeCommandModule(),
    createPresetCommandModule(),
    createLanguageCommandModule(),
    createBackgroundCommandModule(),
    createGoalCommandModule(),
    createShellCommandModule(),
    createEditorCommandModule(),
    createMemoryCommandModule(),
    createUserLocalCommandModule(),
    createCompactCommandModule(),
    createContextCommandModule(),
    createExitCommandModule(),
    createSessionCommandModule(),
    createResetCommandModule(),
    createRewindCommandModule(),
    createScheduleCommandModule(),
    createStatusLineCommandModule(),
    createPluginCommandModule(),
    createSettingsCommandModule(),
    createProviderCommandModule({
      providerDefinitions,
      settings: providerSettingsAdapter,
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
