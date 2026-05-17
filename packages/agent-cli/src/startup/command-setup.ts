import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  getUserSettingsPath,
  readMergedProviderSettings,
  readSettings,
  resolveProviderSettingsWriteTargetPath,
  writeSettings,
} from '@robota-sdk/agent-framework';
import type {
  ICommandHostAdapters,
  ICommandModule,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import {
  createDefaultCommandModules,
  createDefaultPluginCommandAdapter,
  reloadPluginCommandSource,
} from '@robota-sdk/agent-command';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider';

export interface IStartCliOptions {
  commandModules?: readonly ICommandModule[];
  providerDefinitions?: readonly IProviderDefinition[];
}

export interface ICommandSetup {
  commandHostAdapters: ICommandHostAdapters;
  providerDefinitions: readonly IProviderDefinition[];
  commandModules: readonly ICommandModule[];
  reloadPluginCommandSource: (registry: CommandRegistry) => void;
}

export function createCommandSetup(cwd: string, options: IStartCliOptions = {}): ICommandSetup {
  const commandHostAdapters: ICommandHostAdapters = {
    settings: {
      read: () => readSettings(getUserSettingsPath()),
      write: (settings) => writeSettings(getUserSettingsPath(), settings),
    },
    plugin: createDefaultPluginCommandAdapter(cwd),
  };
  const providerDefinitions = options.providerDefinitions ?? createDefaultProviderDefinitions();
  const providerSettingsAdapter = {
    readMergedSettings: () => readMergedProviderSettings(cwd),
    readTargetSettings: () =>
      readSettings(resolveProviderSettingsWriteTargetPath(cwd)) as TProviderSettingsDocument,
    writeTargetSettings: (settings: TProviderSettingsDocument) =>
      writeSettings(resolveProviderSettingsWriteTargetPath(cwd), settings),
  };
  const commandModules: readonly ICommandModule[] = [
    ...createDefaultCommandModules({ cwd, providerDefinitions, providerSettingsAdapter }),
    ...(options.commandModules ?? []),
  ];
  return { commandHostAdapters, providerDefinitions, commandModules, reloadPluginCommandSource };
}
