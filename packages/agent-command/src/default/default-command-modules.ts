import { createAgentCommandModule } from '../agent/index.js';
import { createBackgroundCommandModule } from '../background/index.js';
import { createCompactCommandModule } from '../compact/index.js';
import { createContextCommandModule } from '../context/index.js';
import { createExitCommandModule } from '../exit/index.js';
import { createHelpCommandModule } from '../help/index.js';
import { createLanguageCommandModule } from '../language/index.js';
import { createMemoryCommandModule } from '../memory/index.js';
import { createModeCommandModule } from '../mode/index.js';
import { createPermissionsCommandModule } from '../permissions/index.js';
import { createPluginCommandModule } from '../plugin/index.js';
import { createProviderCommandModule } from '../provider/index.js';
import { createResetCommandModule } from '../reset/index.js';
import { createRewindCommandModule } from '../rewind/index.js';
import { createScheduleCommandModule } from '../schedule/index.js';
import { createSessionCommandModule } from '../session/index.js';
import { createSettingsCommandModule } from '../settings/index.js';
import { createSkillsCommandModule } from '../skills/index.js';
import { createStatusLineCommandModule } from '../statusline/index.js';
import { createUserLocalCommandModule } from '../user-local/index.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { ICommandModule, IProviderCommandSettingsAdapter } from '@robota-sdk/agent-framework';

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
 */
function applyModuleSelection(
  modules: readonly ICommandModule[],
  enabled: readonly string[] | undefined,
  disabled: readonly string[] | undefined,
): readonly ICommandModule[] {
  let selected = modules;
  if (enabled !== undefined) {
    const allow = new Set(enabled);
    selected = selected.filter((module) => allow.has(module.name));
  }
  if (disabled !== undefined) {
    const deny = new Set(disabled);
    selected = selected.filter((module) => !deny.has(module.name));
  }
  return selected;
}

export function createDefaultCommandModules({
  cwd,
  providerDefinitions,
  providerSettingsAdapter,
  enabledCommandModules,
  disabledCommandModules,
}: IDefaultCommandModulesOptions): readonly ICommandModule[] {
  const modules: readonly ICommandModule[] = [
    createSkillsCommandModule({ cwd }),
    createHelpCommandModule(),
    createAgentCommandModule(),
    createPermissionsCommandModule(),
    createModeCommandModule(),
    createLanguageCommandModule(),
    createBackgroundCommandModule(),
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
  return applyModuleSelection(modules, enabledCommandModules, disabledCommandModules);
}
