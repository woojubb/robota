import { findProviderDefinition } from '@robota-sdk/agent-core';
import { applyActiveModelChange } from '@robota-sdk/agent-framework';
import {
  createNodeHostSettingsStore,
  readSettings,
  resolveGitBranchFromNodeHost,
} from '@robota-sdk/agent-framework/node';

import type { IKeyCustodyPort } from './key-custody/key-custody-port.js';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import type { TSettingsSource } from '@robota-sdk/agent-framework';

export interface IDefaultTuiCliAdapterOptions {
  providerDefinitions: readonly IProviderDefinition[];
  reloadPluginCommandSource: (registry: CommandRegistry) => void;
  userSettingsPath: string;
  settingsSources: readonly TSettingsSource[];
  formatResumeCommand?: (sessionId: string) => string;
  keyCustody?: IKeyCustodyPort;
}

export function createDefaultTuiCliAdapter({
  providerDefinitions,
  reloadPluginCommandSource,
  userSettingsPath,
  settingsSources,
  formatResumeCommand,
  keyCustody,
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
    ...(formatResumeCommand === undefined ? {} : { formatResumeCommand }),
    ...(keyCustody === undefined ? {} : { keyCustody }),
  };
}
