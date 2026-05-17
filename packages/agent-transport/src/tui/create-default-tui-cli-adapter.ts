import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import {
  applyActiveModelChange,
  applyStatusLineSettings,
  deleteSettings,
  findProviderDefinition,
  getUserSettingsPath,
  readSettings,
  resolveGitBranch,
  writeSettings,
} from '@robota-sdk/agent-framework';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';

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
    writeSettings: (path, settings) => writeSettings(path, settings),
    deleteSettings: (path) => deleteSettings(path),
    applyStatusLineSettings: (path, patch) => applyStatusLineSettings(path, patch),
    reloadPluginCommandSource: (registry) => {
      reloadPluginCommandSource(registry);
    },
    applyActiveModelChange: (cwd, modelId, options) => {
      applyActiveModelChange(cwd, modelId, options);
      return { applied: true };
    },
    getGitBranch: (cwd) => resolveGitBranch(cwd),
    getProviderDisplayName: (type) =>
      findProviderDefinition(providerDefinitions, type)?.displayName ?? type,
  };
}
