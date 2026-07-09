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
  IUnknownCommandModuleName,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import {
  createDefaultCommandModules,
  createDefaultPluginCommandAdapter,
} from '@robota-sdk/agent-command';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';
import { createWorkflowsCommandModule } from '@robota-sdk/agent-command-workflows';
import type { IParsedCliArgs } from '../utils/cli-args.js';

/**
 * Build the `/workflows` command module (WORKFLOW-003). INFRA-028: the DAG/workflow subsystem is
 * **bundled** into agent-cli's published artifact (it is a build-time devDependency, compiled into
 * `dist`, NOT a runtime `@robota-sdk` edge). It is therefore statically imported and always present —
 * in the monorepo and in a packed/published install alike.
 */
function loadWorkflowsCommandModule(
  providerDefinitions: readonly IProviderDefinition[],
): ICommandModule {
  // FLOW-007: pass the provider definitions so `/workflows create` can resolve the ACTIVE provider
  // to author a workflow from natural language. Workspace layout defaults to `.workflows/`.
  return createWorkflowsCommandModule({ providerDefinitions });
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
  /**
   * INFRA-032: preset `enabledCommandModules`/`disabledCommandModules` names that matched no built
   * command module. Forwarded to `cli.ts`, which writes a non-fatal terminal notice per unknown.
   */
  unknownModuleNames: readonly IUnknownCommandModuleName[];
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
  // DAG workflow engine surfaced as `/workflows` (WORKFLOW-003) — INFRA-028: bundled into the
  // self-contained CLI, so it is always present (statically imported, no runtime `@robota-sdk` edge).
  const workflowsModule = loadWorkflowsCommandModule(providerDefinitions);
  const { modules: defaultModules, unknownModuleNames } = createDefaultCommandModules({
    cwd,
    providerDefinitions,
    providerSettingsAdapter,
    ...(moduleSelection.enabledCommandModules !== undefined
      ? { enabledCommandModules: moduleSelection.enabledCommandModules }
      : {}),
    ...(moduleSelection.disabledCommandModules !== undefined
      ? { disabledCommandModules: moduleSelection.disabledCommandModules }
      : {}),
  });
  const commandModules: readonly ICommandModule[] = [
    ...defaultModules,
    workflowsModule,
    ...(options.commandModules ?? []),
  ];
  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(args)
    ? getStartupCliUpdateNotice({ currentVersion: version })
    : undefined;
  return {
    commandHostAdapters,
    providerDefinitions,
    commandModules,
    unknownModuleNames,
    startupUpdateNoticePromise,
  };
}
