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
import { createWorkflowsCommandModule } from '@robota-sdk/agent-command-workflows';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider';
import type { IParsedCliArgs } from '../utils/cli-args.js';

export interface IStartCliOptions {
  commandModules?: readonly ICommandModule[];
  providerDefinitions?: readonly IProviderDefinition[];
}

/** Preset-resolved command module selection forwarded by the thin-shell CLI. */
export interface ICommandModuleSelection {
  /** Whitelist of module names to keep (omitted → all default modules). */
  enabledCommandModules?: readonly string[];
  /** Blacklist of module names to remove after the whitelist (deny > allow). */
  disabledCommandModules?: readonly string[];
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
  moduleSelection: ICommandModuleSelection = {},
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
    ...createDefaultCommandModules({
      cwd,
      providerDefinitions,
      providerSettingsAdapter,
      ...(moduleSelection.enabledCommandModules !== undefined
        ? { enabledCommandModules: moduleSelection.enabledCommandModules }
        : {}),
      ...(moduleSelection.disabledCommandModules !== undefined
        ? { disabledCommandModules: moduleSelection.disabledCommandModules }
        : {}),
    }),
    // DAG workflow engine surfaced as `/workflows` (WORKFLOW-003); composes dag-framework, not dag-cli.
    createWorkflowsCommandModule(),
    ...(options.commandModules ?? []),
  ];
  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(args)
    ? getStartupCliUpdateNotice({ currentVersion: version })
    : undefined;
  return { commandHostAdapters, providerDefinitions, commandModules, startupUpdateNoticePromise };
}
