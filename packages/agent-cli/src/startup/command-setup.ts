import { homedir } from 'node:os';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  deleteSettings,
  getStartupCliUpdateNotice,
  getUserSettingsPath,
  loadOrgPolicy,
  readMergedProviderSettings,
  readSettings,
  resolveProviderSettingsWriteTarget,
  shouldRunStartupCliUpdateCheck,
  writeSettings,
} from '@robota-sdk/agent-framework';
import type {
  ICliUpdateNotice,
  IOrgPolicy,
  ICommandHostAdapters,
  ICommandModule,
  IWorkspaceProjectMutation,
  IWorkspaceProjectSettingsWriter,
  TProviderSettingsDocument,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import { createDefaultRemoteCommandPolicy } from '@robota-sdk/agent-framework';
import type { IRemoteCommandPolicy } from '@robota-sdk/agent-framework';
import {
  createDefaultCommandModules,
  createDefaultPluginCommandAdapter,
} from '@robota-sdk/agent-command';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';
import {
  createWorkspaceWorkflowProject,
  createWorkflowsCommandModule,
} from '@robota-sdk/agent-command-workflows';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import {
  createCliWorkspaceComposition,
  type ICliWorkspaceComposition,
} from './workspace-project-composition.js';

/**
 * Build the `/workflows` command module (WORKFLOW-003). INFRA-028: the DAG/workflow subsystem is
 * **bundled** into agent-cli's published artifact (it is a build-time devDependency, compiled into
 * `dist`, NOT a runtime `@robota-sdk` edge). It is therefore statically imported and always present —
 * in the monorepo and in a packed/published install alike.
 */
function loadWorkflowsCommandModule(
  providerDefinitions: readonly IProviderDefinition[],
  workspaceComposition: ICliWorkspaceComposition,
  projectMutation: IWorkspaceProjectMutation | undefined,
): ICommandModule {
  // FLOW-007: pass the provider definitions so `/workflows create` can resolve the ACTIVE provider
  // to author a workflow from natural language. Workspace layout defaults to `.workflows/`.
  const project =
    workspaceComposition.projectAccess.status === 'trusted'
      ? createWorkspaceWorkflowProject(
          workspaceComposition.projectAccess.authority,
          projectMutation,
        )
      : undefined;
  return createWorkflowsCommandModule({
    providerDefinitions,
    settingsSources: workspaceComposition.settingsSources,
    ...(project === undefined ? {} : { project }),
  });
}

export interface IStartCliOptions {
  commandModules?: readonly ICommandModule[];
  providerDefinitions?: readonly IProviderDefinition[];
  /** Initial trusted-or-restricted workspace decision. Absence is Restricted. */
  projectAccess?: TWorkspaceProjectAccess;
  /** Separately approved project-settings write capability. */
  projectSettingsWriter?: IWorkspaceProjectSettingsWriter;
  /** Separately approved bounded project mutation capability. */
  projectMutation?: IWorkspaceProjectMutation;
}

export interface ICliSetup {
  commandHostAdapters: ICommandHostAdapters;
  providerDefinitions: readonly IProviderDefinition[];
  /**
   * ARCH-109: whether `providerDefinitions` above came from the caller rather than from
   * `createDefaultProviderDefinitions()`.
   *
   * Reported rather than re-derived, because it cannot be re-derived. The definitions carry
   * `createProvider` and `probeProfile` — functions — so a downstream reader can compare them with
   * the default set only by NAME, and that comparison says "same" in the one case that matters
   * most: a caller-supplied definition sharing a built-in's name while running different code.
   * This function is the only place that still knows which branch was taken.
   */
  callerSuppliedProviderDefinitions: boolean;
  /**
   * CLI-083 (issue #2287) — the org policy read from `~/.robota/org-policy.json`, `null` when there
   * is none. Surfaced because it feeds TWO destinations and only one of them is inside this file:
   * the command-module chain built here (provider `allowedProviders` / `requireApiKeyFromEnv`), and
   * the SESSION, which `cli.ts` assembles for both the served and TUI paths.
   *
   * Loading it here and not returning it left three of the four enforcement sites dead while
   * looking wired — the "the chain exists but is not fed" shape this item is about, recurring one
   * level up. Found in review of the change that restored the loader.
   *
   * Optional rather than `| null` so callers forward it as a plain `orgPolicy,` instead of a
   * conditional spread. A spread bypasses TypeScript's excess-property check, which is how a third
   * recurrence reached the TUI layer and was dropped there in silence. Written plainly, a target
   * that does not declare the field fails to compile.
   */
  orgPolicy?: IOrgPolicy | undefined;
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
  workspaceComposition: ICliWorkspaceComposition;
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
  const workspaceComposition = createCliWorkspaceComposition({
    cwd,
    userHome: homedir(),
    ...(options.projectAccess !== undefined ? { projectAccess: options.projectAccess } : {}),
    ...(options.projectSettingsWriter !== undefined
      ? { projectSettingsWriter: options.projectSettingsWriter }
      : {}),
  });
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
  const providerSettingsSources = workspaceComposition.settingsSources;
  const providerSettingsStore = resolveProviderSettingsWriteTarget(
    workspaceComposition.settingsStores,
  );
  const providerSettingsAdapter = {
    readMergedSettings: () => readMergedProviderSettings(providerSettingsSources),
    readTargetSettings: () => providerSettingsStore.read() as TProviderSettingsDocument,
    writeTargetSettings: (settings: TProviderSettingsDocument) =>
      providerSettingsStore.write(settings),
  };
  // DAG workflow engine surfaced as `/workflows` (WORKFLOW-003) — INFRA-028: bundled into the
  // self-contained CLI, so it is always present (statically imported, no runtime `@robota-sdk` edge).
  const workflowsModule = loadWorkflowsCommandModule(
    providerDefinitions,
    workspaceComposition,
    options.projectMutation,
  );
  // The pack-supplied modules are excluded from the base; `assembleProduct` merges them back in from the
  // profile's packs. `unknownModuleNames` is not read here — every excluded name is a real module, and the
  // preset delta's unknown-name diagnostics are computed by the shell against the MERGED superset.
  // CLI-083 (issue #2287). This call is where `loadOrgPolicy()` used to be: `48ebec353` added it,
  // `92596bc6f` removed it two days later while slimming this file, and four implemented enforcement
  // sites have been unreachable since. Nothing failed, because the parameter is optional and its
  // consumers read absence as "no policy configured".
  const orgPolicy = loadOrgPolicy();
  const { modules: baseCommandModules } = createDefaultCommandModules({
    cwd,
    providerDefinitions,
    providerSettingsAdapter,
    contributionSources: workspaceComposition.contributionSources,
    ...(orgPolicy === null ? {} : { orgPolicy }),
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
    callerSuppliedProviderDefinitions: options.providerDefinitions !== undefined,
    baseCommandModules,
    // CLI-083 (issue #2287). Returned, not just consumed above: the command-module chain reaches the
    // provider checks, and the SESSION-level `blockedCommands` enforcement is fed from `cli.ts`
    // instead. Loading it here and not surfacing it left three of the four enforcement sites dead
    // and looked wired — the same "the chain exists but is not fed" shape this item is about, one
    // level up. Found in review of this change.
    //
    // Normalised to `undefined` here so every downstream forward is a plain `orgPolicy,` rather than
    // a conditional spread: a spread bypasses the excess-property check, which is how the third
    // recurrence reached the TUI layer and was dropped in silence.
    orgPolicy: orgPolicy ?? undefined,
    fixedCommandModules: [workflowsModule, ...(options.commandModules ?? [])],
    startupUpdateNoticePromise,
    remoteCommandPolicy: createDefaultRemoteCommandPolicy(), // REMOTE-006: allow-by-default (local == remote).
    workspaceComposition,
  };
}
