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
}

export function createDefaultCommandModules({
  cwd,
  providerDefinitions,
  providerSettingsAdapter,
}: IDefaultCommandModulesOptions): readonly ICommandModule[] {
  return [
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
    createStatusLineCommandModule(),
    createPluginCommandModule(),
    createSettingsCommandModule(),
    createProviderCommandModule({
      providerDefinitions,
      settings: providerSettingsAdapter,
    }),
  ];
}
