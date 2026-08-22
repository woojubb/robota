import { findProviderDefinition } from '@robota-sdk/agent-core';
import {
  applyActiveModelChange,
  createDefaultUserSettingsSources,
  createNodeHostSettingsStore,
  getUserSettingsPath,
  readSettings,
  resolveGitBranch,
} from '@robota-sdk/agent-framework';

import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { CommandRegistry } from '@robota-sdk/agent-framework';

export interface IDefaultTuiCliAdapterOptions {
  providerDefinitions: readonly IProviderDefinition[];
  reloadPluginCommandSource: (registry: CommandRegistry) => void;
}

export function createDefaultTuiCliAdapter({
  providerDefinitions,
  reloadPluginCommandSource,
}: IDefaultTuiCliAdapterOptions): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => getUserSettingsPath(),
    readSettings: (path) => readSettings(path),
    reloadPluginCommandSource: (registry) => {
      reloadPluginCommandSource(registry);
    },
    applyActiveModelChange: (_cwd, modelId, options) => {
      const userStore = createNodeHostSettingsStore('user', getUserSettingsPath());
      applyActiveModelChange(createDefaultUserSettingsSources(), [userStore], modelId, options);
      return { applied: true };
    },
    getGitBranch: (cwd) => resolveGitBranch(cwd),
    getProviderDisplayName: (type) =>
      findProviderDefinition(providerDefinitions, type)?.displayName ?? type,
  };
}
