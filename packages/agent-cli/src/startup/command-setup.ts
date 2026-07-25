import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  deleteSettings,
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
import { createDefaultRemoteCommandPolicy } from '@robota-sdk/agent-framework';
import type { IRemoteCommandPolicy } from '@robota-sdk/agent-framework';
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

export interface ICliSetup {
  commandHostAdapters: ICommandHostAdapters;
  providerDefinitions: readonly IProviderDefinition[];
  /**
   * ARCH-005 S2: the product's BASE command modules — the default set MINUS the modules a capability pack
   * supplies (`packCommandModuleNames`). They are handed to `assembleProduct` as
   * `IProductProfile.baseCommandModules`, which merges the packs on top; the preset's
   * enabled/disabled delta is applied to that merged superset AFTERWARDS (spec: "this merger only
   * produces the base ⊕ pack superset that the preset delta then filters"). So the delta is deliberately
   * NOT applied here.
   */
  baseCommandModules: readonly ICommandModule[];
  /**
   * Modules the preset delta never filters: `/workflows` (bundled into the CLI artifact) and any modules a
   * caller injected via {@link IStartCliOptions.commandModules}. Appended after the selected set, exactly
   * as before the ARCH-005 restructure.
   */
  fixedCommandModules: readonly ICommandModule[];
  startupUpdateNoticePromise: Promise<ICliUpdateNotice | undefined> | undefined;
  /**
   * REMOTE-006: optional command-execution policy for remote-origin commands (WebSocket / WebRTC). **Allow by
   * default** — local == remote (pairing is the trust boundary; the universal permission system governs anything
   * dangerous). Injected only so a consumer can opt into a restriction.
   */
  remoteCommandPolicy: IRemoteCommandPolicy;
}

/**
 * Build the product-shell materials the CLI feeds into `assembleProduct`: the host adapters, the provider
 * definitions, and the BASE command modules.
 *
 * `packCommandModuleNames` are the module names a capability pack in the product profile supplies — they are
 * excluded here so the pack is their single source, and `mergeCapabilityPacks` re-adds them additively
 * rather than rejecting them as base collisions. Removing the pack from the profile therefore genuinely
 * removes those commands from the product.
 */
export function buildCommandSetup(
  cwd: string,
  args: IParsedCliArgs,
  options: IStartCliOptions,
  version: string,
  packCommandModuleNames: readonly string[] = [],
): ICliSetup {
  const commandHostAdapters: ICommandHostAdapters = {
    settings: {
      read: () => readSettings(getUserSettingsPath()),
      write: (settings) => writeSettings(getUserSettingsPath(), settings),
      // CMD-004 Phase 2: the host-executed `settings-reset` action deletes the user settings document.
      delete: () => deleteSettings(getUserSettingsPath()),
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
  // The pack-supplied modules are excluded from the base; `assembleProduct` merges them back in from the
  // profile's packs. `unknownModuleNames` is not read here — every excluded name is a real module, and the
  // preset delta's unknown-name diagnostics are computed by the shell against the MERGED superset.
  const { modules: baseCommandModules } = createDefaultCommandModules({
    cwd,
    providerDefinitions,
    providerSettingsAdapter,
    ...(packCommandModuleNames.length > 0
      ? { disabledCommandModules: packCommandModuleNames }
      : {}),
  });
  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(args)
    ? getStartupCliUpdateNotice({ currentVersion: version })
    : undefined;
  return {
    commandHostAdapters,
    providerDefinitions,
    baseCommandModules,
    fixedCommandModules: [workflowsModule, ...(options.commandModules ?? [])],
    startupUpdateNoticePromise,
    remoteCommandPolicy: createDefaultRemoteCommandPolicy(), // REMOTE-006: allow-by-default (local == remote).
  };
}
