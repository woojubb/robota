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
import { createRequire } from 'node:module';

import {
  createDefaultCommandModules,
  createDefaultPluginCommandAdapter,
} from '@robota-sdk/agent-command';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider';
import type { IParsedCliArgs } from '../utils/cli-args.js';

/**
 * Load the optional `/workflows` command module (WORKFLOW-003). The DAG/workflow subsystem is an
 * in-progress track kept out of the published dependency graph, so agent-cli must NOT hard-depend on
 * it — otherwise the published package's `workspace:*` edge resolves to an unpublished version and
 * `npm install @robota-sdk/agent-cli` breaks. `@robota-sdk/agent-command-workflows` is therefore a
 * devDependency, loaded through a guarded `createRequire`: present in the monorepo (and for any user
 * who installs it) → `/workflows` is registered; absent in the default published install → omitted.
 */
function loadOptionalWorkflowsCommandModule(): ICommandModule | undefined {
  try {
    const requireFrom = createRequire(import.meta.url);
    const mod = requireFrom('@robota-sdk/agent-command-workflows') as {
      createWorkflowsCommandModule: () => ICommandModule;
    };
    return mod.createWorkflowsCommandModule();
  } catch {
    // allow-fallback: the workflow subsystem is an optional, unpublished track — its absence just means no /workflows command
    return undefined;
  }
}

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
  // DAG workflow engine surfaced as `/workflows` (WORKFLOW-003) — optional; omitted from the published
  // CLI whose dependency graph must not include the unpublished DAG chain (see loader doc above).
  const workflowsModule = loadOptionalWorkflowsCommandModule();
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
    ...(workflowsModule ? [workflowsModule] : []),
    ...(options.commandModules ?? []),
  ];
  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(args)
    ? getStartupCliUpdateNotice({ currentVersion: version })
    : undefined;
  return { commandHostAdapters, providerDefinitions, commandModules, startupUpdateNoticePromise };
}
