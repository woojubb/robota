import { findProviderDefinition } from '@robota-sdk/agent-core';
import {
  applyActiveModelChange,
  createNodeHostSettingsStore,
  readSettings,
  resolveGitBranchFromNodeHost,
} from '@robota-sdk/agent-framework';

import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import type { TSettingsSource } from '@robota-sdk/agent-framework';

export interface IDefaultTuiCliAdapterOptions {
  providerDefinitions: readonly IProviderDefinition[];
  reloadPluginCommandSource: (registry: CommandRegistry) => void;
  userSettingsPath: string;
  settingsSources: readonly TSettingsSource[];
}

export function createDefaultTuiCliAdapter({
  providerDefinitions,
  reloadPluginCommandSource,
  userSettingsPath,
  settingsSources,
}: IDefaultTuiCliAdapterOptions): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => userSettingsPath,
    readSettings: (path) => readSettings(path),
    reloadPluginCommandSource: (registry) => {
      reloadPluginCommandSource(registry);
    },
    applyActiveModelChange: (_cwd, modelId, options) => {
      const userStore = createNodeHostSettingsStore('user', userSettingsPath);
      applyActiveModelChange(settingsSources, [userStore], modelId, options);
      return { applied: true };
    },
    getGitBranch: (cwd) => resolveGitBranchFromNodeHost(cwd),
    getProviderDisplayName: (type) =>
      findProviderDefinition(providerDefinitions, type)?.displayName ?? type,
  };
}
