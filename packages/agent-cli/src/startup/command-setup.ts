import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  getStartupCliUpdateNotice,
  getUserSettingsPath,
  readMergedProviderSettings,
  readSettings,
  resolveProviderSettingsWriteTargetPath,
  shouldRunStartupCliUpdateCheck,
  writeSettings,
} from '@robota-sdk/agent-framework';
import type {
  ICliUpdateNotice,
  ICommandHostAdapters,
  ICommandModule,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import {
  createDefaultCommandModules,
  createDefaultPluginCommandAdapter,
} from '@robota-sdk/agent-command';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider';
import type { IParsedCliArgs } from '../utils/cli-args.js';

export interface IStartCliOptions {
  commandModules?: readonly ICommandModule[];
  providerDefinitions?: readonly IProviderDefinition[];
}

export interface ICliSetup {
  commandHostAdapters: ICommandHostAdapters;
  providerDefinitions: readonly IProviderDefinition[];
  commandModules: readonly ICommandModule[];
  startupUpdateNoticePromise: Promise<ICliUpdateNotice | undefined> | undefined;
}

export function buildCommandSetup(
  cwd: string,
  args: IParsedCliArgs,
  options: IStartCliOptions,
  version: string,
): ICliSetup {
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
  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(args)
    ? getStartupCliUpdateNotice({ currentVersion: version })
    : undefined;
  return { commandHostAdapters, providerDefinitions, commandModules, startupUpdateNoticePromise };
}
