import { resolveCliRuntimeContext } from './product-bootstrap.js';
import { resolve } from 'node:path';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  createSettingsPermissionRulesAdapter,
  OrgPolicyParseError,
  readMergedProviderSettings,
  inspectSettingsLayers,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
  prepareWorkflowJsonMutation,
  resolveProviderSettingsWriteTarget,
} from '@robota-sdk/agent-framework';
import {
  NodeFileSystemAsync,
  createGitProcess,
  deleteSettings,
  loadOrgPolicy,
  readSettings,
  writeSettings,
} from '@robota-sdk/agent-framework/node';
import type {
  IOrgPolicy,
  ICommandHostAdapters,
  ICommandModule,
  IWorkspaceProjectMutation,
  TProviderSettingsDocument,
  TSettingsSource,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import {
  getStartupCliUpdateNotice,
  shouldRunStartupCliUpdateCheck,
} from '../update-check/update-check.js';
import type { ICliUpdateNotice } from '../update-check/update-check.js';
import { createDefaultRemoteCommandPolicy } from '@robota-sdk/agent-framework';
import type { IRemoteCommandPolicy } from '@robota-sdk/agent-framework';
import { createDefaultCommandModules } from '@robota-sdk/agent-product/command';
import { createNodeDoctorDeps, openFileInEditor } from '@robota-sdk/agent-product/command/node';
import { createDevicesCommandPort } from '../devices/index.js';
import type {
  IDevicesMeshStatus,
  IKeyCustodyCommandPort,
  IKeybindingsFilePort,
  IThemeCataloguePort,
} from '@robota-sdk/agent-product/command';
import { createOutputStyleRegistry, loadOutputStylesFromSources } from '@robota-sdk/agent-product/preset';
import { productProviderDefinitions } from '../product/provider-definitions.js';
import {
  createWorkspaceWorkflowProject,
  createWorkflowsCommandModule,
} from '@robota-sdk/workflows/command';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import { wrapWorkflowModule } from './workflow-write-approval.js';
import { buildDoctorInputs } from './doctor-inputs.js';

import type { IProductSandbox } from '../product/execution-containment.js';
import {
  areSessionLoopsDisabled,
  createLoopDefaultPromptResolver,
  DEFAULT_LOOP_MAINTENANCE_PROMPT,
} from './loop-options.js';
import { createDefaultPluginCommandAdapter } from '../plugins/default-plugin-command-adapter.js';
import { productUserSettingsPath } from '../product/user-settings.js';
import { userLocalStorageRoot, userPaths } from '../product/user-paths.js';
import { buildOutputStyleSources } from './output-style-sources.js';
import type { IOutputStyleRegistry } from '@robota-sdk/agent-product/preset';
import {
  createCliWorkspaceComposition,
  type ICliWorkspaceComposition,
} from './workspace-project-composition.js';
import type { IStartCliOptions } from './cli-options-types.js';
import {
  createCliOpenRouterConnectionHost,
  type IOpenRouterConnectionHost,
} from './openrouter-connection-host.js';

export type { IStartCliOptions } from './cli-options-types.js';

/**
 * Build the `/workflows` command module. The DAG/workflow subsystem is
 * **bundled** into agent-cli's published artifact (it is a build-time devDependency, compiled into
 * `dist`, NOT a runtime `@robota-sdk` edge). It is therefore statically imported and always present —
 * in the monorepo and in a packed/published install alike.
 */
function loadWorkflowsCommandModule(
  providerDefinitions: readonly IProviderDefinition[],
  workspaceComposition: ICliWorkspaceComposition,
  projectMutation: IWorkspaceProjectMutation | undefined,
  allowDetachedRuns: boolean,
  environment: Readonly<Record<string, string | undefined>>,
): ICommandModule {
  // Pass the provider definitions so `/workflows create` can resolve the ACTIVE provider
  // to author a workflow from natural language. Workspace layout defaults to `.workflows/`.
  const project =
    workspaceComposition.projectAccess.status === 'trusted'
      ? createWorkspaceWorkflowProject(
          workspaceComposition.projectAccess.authority,
          projectMutation,
        )
      : undefined;
  const moduleOptions = {
    providerDefinitions,
    settingsSources: workspaceComposition.settingsSources,
    environment,
    allowDetachedRuns,
    ...(project === undefined ? {} : { project }),
  };
  const module = createWorkflowsCommandModule(moduleOptions);
  const access = workspaceComposition.projectAccess;
  if (projectMutation !== undefined || access.status !== 'trusted') return module;
  return wrapWorkflowModule(
    module,
    () => prepareWorkflowJsonMutation(access.authority),
    async (mutation, context, args) => {
      const approvedModule = createWorkflowsCommandModule({
        ...moduleOptions,
        project: createWorkspaceWorkflowProject(access.authority, mutation),
      });
      const approvedCommand = approvedModule.systemCommands?.find(
        (item) => item.name === 'workflows',
      );
      if (approvedCommand === undefined)
        return { success: false, message: 'Workflow command is unavailable.' };
      return approvedCommand.execute(context, args);
    },
  );
}

export interface ICliSetup {
  providerConnectionHost: IOpenRouterConnectionHost;
  commandHostAdapters: ICommandHostAdapters;
  outputStyleRegistry: IOutputStyleRegistry;
  outputStyleLoadErrors: readonly { file: string; error: string }[];
  providerDefinitions: readonly IProviderDefinition[];
  /**
   * Whether `providerDefinitions` above came from the caller rather than from
   * `productProviderDefinitions()`.
   *
   * Reported rather than re-derived, because it cannot be re-derived. The definitions carry
   * `createProvider` and `probeProfile` — functions — so a downstream reader can compare them with
   * the default set only by NAME, and that comparison says "same" in the one case that matters
   * most: a caller-supplied definition sharing a built-in's name while running different code.
   * This function is the only place that still knows which branch was taken.
   */
  callerSuppliedProviderDefinitions: boolean;
  /**
   * The org policy read from `the configured user root/org-policy.json`, `null` when there
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
   * The product's BASE command modules — the default set MINUS the modules a capability pack
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
   * as the selected set is built.
   */
  fixedCommandModules: readonly ICommandModule[];
  startupUpdateNoticePromise: Promise<ICliUpdateNotice | undefined> | undefined;
  /**
   * Optional command-execution policy for remote-origin commands (WebSocket / WebRTC). **Allow by
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
/** Resolve the effective declaration without granting write authority to its source. */
export function providerSelectionSettingsPath(
  cwd: string,
  sources: readonly TSettingsSource[],
  fallback: TSettingsSource,
  projectAccess?: TWorkspaceProjectAccess,
): string | undefined {
  try {
    const inspection = inspectSettingsLayers(sources);
    if (inspection.partial) return undefined;
    const source = inspection.layers.findLast((layer) => layer.settings?.currentProvider !== undefined)?.source ?? fallback;
    if (source.kind === 'project') {
      if (projectAccess?.status !== 'trusted') return undefined;
      if (source.reader !== getWorkspaceProjectReader(projectAccess.authority)) return undefined;
      return resolve(getWorkspaceProjectIdentity(projectAccess.authority).worktreeRoot, source.relativePath);
    }
    return source.path === undefined ? undefined : resolve(cwd, source.path);
  } catch {
    return undefined;
  }
}

export function buildCommandSetup(
  cwd: string,
  args: IParsedCliArgs,
  options: IStartCliOptions,
  version: string,
  packCommandModuleNames: readonly string[] = [],
  keybindingsFilePort?: IKeybindingsFilePort,
  themeCataloguePort?: IThemeCataloguePort,
  sandbox?: IProductSandbox,
  /**
   * The device mesh this session may open; `/devices` shows its status and tells it when the
   * identity or its lists changed.
   */
  mesh?: {
    readonly status: () => IDevicesMeshStatus;
    readonly identityChanged: () => void;
  },
  /**
   * The TUI's hold on the keys of secure conversations; `/unlock` and `/lock` exist only
   * with it, so a plain product, or a process with no terminal to ask on, has neither.
   */
  keyCustodyPort?: IKeyCustodyCommandPort,
  reportedCredentialNames?: readonly string[],
): ICliSetup {
  const productRuntime = resolveCliRuntimeContext(options);
  const workspaceComposition = createCliWorkspaceComposition({
    cwd,
    productRuntime,
    userHome: productRuntime.userHome ?? productRuntime.layout.userRoot,
    ...(options.projectAccess !== undefined ? { projectAccess: options.projectAccess } : {}),
    ...(options.projectSettingsWriter !== undefined
      ? { projectSettingsWriter: options.projectSettingsWriter }
      : {}),
    ...(options.safeMode === true ? { safeMode: true } : {}),
    ...(args.noSessionPersistence ? { ephemeralEditCheckpoints: true } : {}),
  });
  const outputStyleSources = buildOutputStyleSources({
    ...(options.safeMode === true ? { safeMode: true } : {}),
    cwd,
    productRuntime,
    userHome: productRuntime.userHome ?? productRuntime.layout.userRoot,
    projectAccess: workspaceComposition.projectAccess,
    managedOutputStyleSources: options.managedOutputStyleSources,
  });
  const outputStyleLoad = loadOutputStylesFromSources(outputStyleSources);
  const outputStyleRegistry = createOutputStyleRegistry(outputStyleSources);
  const commandHostAdapters: ICommandHostAdapters = {
    settings: {
      read: () => readSettings(productUserSettingsPath(productRuntime)),
      write: (settings) => writeSettings(productUserSettingsPath(productRuntime), settings),
      // The host-executed `settings-reset` action deletes the user settings document.
      delete: () => deleteSettings(productUserSettingsPath(productRuntime)),
    },
    plugin: createDefaultPluginCommandAdapter(cwd, productRuntime),
    // `settingsStores` gives the adapter a WRITE target per scope, so the Settings
    // screen's rule Remove button rewrites the same file `/permissions` reads the rule from.
    permissionRules: createSettingsPermissionRulesAdapter(
      workspaceComposition.settingsSources,
      workspaceComposition.settingsStores,
    ),
    ...(options.mcpActivationAdapter === undefined
      ? {}
      : { mcpActivation: options.mcpActivationAdapter }),
    ...(options.mcpActivationAdapter?.skills?.commandSource === undefined
      ? {}
      : { skillCommands: options.mcpActivationAdapter.skills.commandSource }),
    outputStyleRegistry,
  };
  const providerDefinitions = options.providerDefinitions ?? productProviderDefinitions();
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
  // DAG workflow engine surfaced as `/workflows`, bundled into the
  // self-contained CLI, so it is always present (statically imported, no runtime `@robota-sdk` edge).
  const workflowsModule = loadWorkflowsCommandModule(
    providerDefinitions,
    workspaceComposition,
    options.projectMutation,
    !args.printMode && args.goal === undefined,
    resolveCliRuntimeContext(options).environment,
  );
  // The pack-supplied modules are excluded from the base; `assembleProduct` merges them back in from the
  // profile's packs. `unknownModuleNames` is not read here — a pack may supply a module the default set
  // does not build (`/shell` and `/editor` live on `agent-command/node`), and the preset delta's
  // unknown-name diagnostics are computed by the shell against the MERGED superset.
  // This call is where `loadOrgPolicy()` is read: dropping it leaves four implemented enforcement
  // sites unreachable. Nothing fails, because the parameter is optional and its
  // consumers read absence as "no policy configured".
  const orgPolicy = loadOrgPolicy(userPaths(productRuntime).orgPolicy);
  const providerConnectionHost =
    options.providerConnectionHost ?? createCliOpenRouterConnectionHost(productRuntime, orgPolicy);
  // `/doctor` runs the same runner as `the product doctor`, over the inputs this host
  // composed; the shell supplies them, the command package owns the behaviour.
  const doctorInputs = buildDoctorInputs({
    cwd,
    ...(sandbox !== undefined ? { sandbox } : {}),
    version,
    options,
    projectAccess: workspaceComposition.projectAccess,
    providerDefinitions,
    env: productRuntime.environment,
  });
  const { modules: baseCommandModules } = createDefaultCommandModules({
    cwd,
    userLocalStorageRoot: userLocalStorageRoot(productRuntime),
    userLocalFileSystem: new NodeFileSystemAsync(),
    providerDefinitions,
    providerSettingsAdapter,
    providerConnectionHost,
    providerCredentialResolver: providerConnectionHost.resolveCredential,
    ...(reportedCredentialNames === undefined ? {} : {
      missingEnvironmentCredentialHint: (profile: string, name: string): string => {
        const report = reportedCredentialNames.includes(name)
          ? `The launching process reported ${name} was set, but it was not forwarded.`
          : `The launching process did not report ${name} as set. Set it in the environment used to start the runtime.`;
        const path = providerSelectionSettingsPath(cwd, providerSettingsSources, providerSettingsStore.source, workspaceComposition.projectAccess);
        const selection = path === undefined
          ? 'The effective settings source could not be determined; inspect the settings layers before changing "currentProvider".'
          : `In ${JSON.stringify(path)}, set "currentProvider" to ${JSON.stringify(profile)}.`;
        const cli = productRuntime.vocabulary.cliName;
        const stop = args.supervisedSessionId === undefined ? 'Stop this secure runtime' : `Stop it with ${cli} session stop ${args.supervisedSessionId}`;
        return `${report} ${selection} ${stop}; then start a new secure daemon with ${cli} daemon start from the workspace, using an environment where ${name} is set, or restart through a supervisor that supports secure forwarding.`;
      },
    }),
    // The provider commands check `$ENV:` credentials against the snapshot taken before the runtime
    // withheld its own credentials from `process.env` — the live env no longer has them.
    providerEnvironment: productRuntime.environment,
    contributionSources: workspaceComposition.contributionSources,
    skillRoots: workspaceComposition.skillRoots,
    ...(keybindingsFilePort === undefined ? {} : { keybindingsFilePort }),
    keybindingsEditor: openFileInEditor,
    gitProcess: createGitProcess(),
    ...(themeCataloguePort === undefined ? {} : { themeCataloguePort }),
    // `/devices`: identity state under the configured user root/devices, keys in the host credential store, and the
    // recovery phrase only on this process's own terminal.
    devicesPort: createDevicesCommandPort({
      productRuntime,
      ...(mesh !== undefined
        ? { meshStatus: mesh.status, onIdentityChanged: mesh.identityChanged }
        : {}),
    }),
    ...(keyCustodyPort === undefined ? {} : { keyCustodyPort }),
    doctorInputs,
    doctorDeps: createNodeDoctorDeps({ ...doctorInputs.env }),
    doctorDisplay: productRuntime.vocabulary.doctorSlash,
    formatForkResumeCommand: productRuntime.vocabulary.resumeCommand,
    loopOptions: {
      defaultPrompt: DEFAULT_LOOP_MAINTENANCE_PROMPT,
      resolveDefaultPrompt: createLoopDefaultPromptResolver({
        productRuntime,
        projectAccess: workspaceComposition.projectAccess,
        userHome: productRuntime.userHome ?? productRuntime.layout.userRoot,
      }),
      disabled: areSessionLoopsDisabled(productRuntime.environment),
    },
    ...(orgPolicy === null ? {} : { orgPolicy }),
    ...(packCommandModuleNames.length > 0
      ? { disabledCommandModules: packCommandModuleNames }
      : {}),
  });
  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(args)
    ? getStartupCliUpdateNotice({ productRuntime, currentVersion: version })
    : undefined;
  return {
    providerConnectionHost,
    commandHostAdapters,
    outputStyleRegistry,
    outputStyleLoadErrors: outputStyleLoad.errors,
    providerDefinitions,
    callerSuppliedProviderDefinitions: options.providerDefinitions !== undefined,
    baseCommandModules,
    // Returned, not just consumed above: the command-module chain reaches the
    // provider checks, and the SESSION-level `blockedCommands` enforcement is fed from `cli.ts`
    // instead. Loading it here and not surfacing it left three of the four enforcement sites dead
    // and looked wired — the "chain exists but is not fed" shape, one
    // level up.
    //
    // Normalised to `undefined` here so every downstream forward is a plain `orgPolicy,` rather than
    // a conditional spread: a spread bypasses the excess-property check, which is how the third
    // recurrence reached the TUI layer and was dropped in silence.
    orgPolicy: orgPolicy ?? undefined,
    fixedCommandModules: [workflowsModule, ...(options.commandModules ?? [])],
    startupUpdateNoticePromise,
    remoteCommandPolicy: createDefaultRemoteCommandPolicy(), // Allow-by-default (local == remote).
    workspaceComposition,
  };
}

/**
 * `buildCommandSetup`, with the one startup failure that is terminal presented rather than thrown.
 *
 * An org policy file that EXISTS and cannot be read means the policy is NOT applied.
 * Starting anyway is the fail-open that change removed, and crashing with a stack trace is the
 * "must not crash CLI startup" outcome the comment it replaced was protecting — an administrator
 * needs to see which file to fix, not a trace.
 *
 * Presented the way `resolveShellPreset` presents an unknown preset id: message to stderr, exit 1.
 * It lives HERE rather than in `cli.ts` because that file is at its size baseline, and because the
 * presentation of a setup failure belongs beside the setup rather than in the shell that calls it.
 *
 * **Narrow on purpose.** A broad catch would turn every unrelated startup defect into a clean exit
 * carrying someone else's message, which is a worse failure than the one being fixed.
 */
export function buildCommandSetupOrExit(
  ...args: Parameters<typeof buildCommandSetup>
): ReturnType<typeof buildCommandSetup> {
  try {
    return buildCommandSetup(...args);
  } catch (error) {
    if (!(error instanceof OrgPolicyParseError)) throw error;
    // allow-fallback: an unreadable org policy is terminal — surface the file, exit
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
