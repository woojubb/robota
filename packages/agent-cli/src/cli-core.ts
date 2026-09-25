import { homedir } from 'node:os';

import { PrintTerminal } from './print-terminal.js';
import {
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
  InteractiveSession,
  readProviderSettings,
  readMergedProviderSettings,
  readSettings,
  writeSettings,
  type IBackgroundTaskRunner,
} from '@robota-sdk/agent-framework';
import { assembleProduct } from '@robota-sdk/agent-product';

import { createFileCostBudgetAdapter } from './startup/cost-budget-adapter.js';
import { checkForCliUpdate, formatCliUpdateCheckMessage } from './update-check/update-check.js';
import { resolveCliUpdateNotice } from './update-check/resolve-cli-update-notice.js';
import { parseCliArgs, printHelp, type IParsedCliArgs } from './utils/cli-args.js';
import { loadRobotaExternalPresets, resolveShellPreset } from './startup/preset-selection.js';
import type { IShellPresetResolution } from './startup/preset-selection.js';
import { ROBOTA_DEFAULT_AGENT_NAME } from './product/robota-preset-defaults.js';
import { ROBOTA_AGENT_DEFINITION_ROOTS } from './product/robota-agent-roots.js';
import { robotaPluginDirectories } from './product/robota-plugin-paths.js';
import {
  createRobotaSandbox,
  createSandboxCommandAdapter,
  sandboxStartupProblem,
} from './product/robota-execution-containment.js';
import { ROBOTA_PROJECT_SETTINGS } from './product/robota-project-settings.js';
import {
  createRobotaUserSettingsSources,
  robotaUserSettingsPath,
} from './product/robota-user-settings.js';
import { readUserSettingsOrExit } from './startup/user-settings.js';
import { runShellCommand } from './startup/shell-exec.js';
import { buildPresetSurfaceOptions, toSessionOptions } from './startup/preset-surface-options.js';
import { createCliEffortAdapter, resolveCliModelEffort } from './startup/effort-resolution.js';
import { resolveOutputStyle, selectOutputStyleId } from './startup/output-style-selection.js';
import type { IPreset } from '@robota-sdk/agent-preset';
import { bindAssembledCollaborators } from './product/assembled-collaborators.js';
import { createRobotaProfile } from './product/robota-profile.js';
import { formatRobotaResumeCommand } from './product/robota-command-vocabulary.js';
import { createRobotaKeybindingsOptions } from './product/robota-keybindings.js';
import { ROBOTA_TASK_CONTEXT } from './product/robota-task-context.js';
import {
  buildRobotaRuntimeOptions,
  loadReplayProvider,
  reportUnknownPresetModules,
  selectProductCommandModules,
  createChannelReadyHandler,
} from './product/robota-plumbing.js';
import { createRemoteControlController } from './remote-control/index.js';
import { createCliUsageTransportRegistry } from './usage/usage-transport-registry.js';
import { createConfiguredNodeOtlpLiveTelemetryPort } from './telemetry/live-trace-otlp.js';
import { takeRobotaTelemetryEnvironment } from './telemetry/live-telemetry-env.js';
import { resolveLiveTelemetrySurface } from './telemetry/live-resource.js';
import { createCliLiveContentRedaction } from './telemetry/live-content-secrets.js';
import {
  createRobotaPackSet,
  ROBOTA_OS_SANDBOX_TYPE,
  createRobotaSubagentRunnerFactory,
} from './product/robota-subagent-composition.js';
import { reloadPluginCommandSource } from './plugins/default-plugin-command-source-loader.js';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';
import { runSessionAnalyze } from './session-analyzer/session-analyze-command.js';
import { runEvalCommand } from './eval/eval-command.js';
import { readVersion } from './startup/version.js';
import { runResetConfig } from './startup/reset-config.js';
import { isFirstRun, markOnboarded, printFirstRunWelcome } from './startup/first-run.js';
import { warnIfTerminalAppOnMacOS } from './startup/terminal-check.js';
import type { IStartCliOptions } from './startup/command-setup.js';
import { buildCommandSetupOrExit } from './startup/command-setup.js';
import {
  areSessionLoopsDisabled,
  createLoopDefaultPromptResolver,
} from './startup/loop-options.js';
import {
  createInitialCliWorkspaceComposition,
  resolveStartupWorkspaceProjectAccess,
  SAFE_MODE_FLAG,
  SAFE_MODE_NOTICE,
} from './startup/workspace-project-composition.js';
import { runPreparsedCliCommand } from './startup/preparsed-command-routing.js';
import { applyLaunchInvocation } from './launch-intent/open-invocation-host.js';
import { routeProjectSetup } from './startup/project-setup-routing.js';
import { attachHostAdapters, createTuiProcessAdapter } from './startup/host-action-adapters.js';
import {
  argvCarryingSafeMode,
  createWorkspaceMoveAdapter,
} from './startup/workspace-move-adapter.js';
import { runPrintMode } from './modes/print-mode.js';
import { buildServeSessionOptions, runServeMode } from './modes/serve-mode.js';
import { ROBOTA_PERMISSION_BASELINE } from './product/robota-permission-baseline.js';
import { runMcpServeMode } from './modes/mcp-serve-mode.js';
import { reserveMcpStdout } from './modes/mcp-stdio-output.js';
import { composeMcpClientForStartup } from './startup/mcp-startup.js';
import { composeCliAdvisor } from './startup/advisor-composition.js';
import { createMcpExternalEventHost } from './startup/mcp-external-event-host.js';
import type { TMcpStartupMode } from './startup/mcp-startup.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { Writable } from 'node:stream';
import { resolveMemorySurfaceOptions } from './startup/memory-enablement.js';
import { resolveFocusReportingOverride } from './startup/focus-reporting-enablement.js';
import { resolveRobotaTerminalCapabilities } from './startup/terminal-capabilities-projection.js';
import { resolvePromptHistoryRenderFields } from './startup/prompt-history-enablement.js';
import { resolveScreenReaderRenderFields } from './startup/screen-reader-enablement.js';
import { resolveRobotaScreenReaderPacing } from './startup/screen-reader-pacing-projection.js';
import { resolveRobotaShellExecutable } from './product/robota-shell.js';
import {
  formatHeadlessWorkspaceTrustError,
  requiresHeadlessWorkspaceTrust,
} from './startup/workspace-trust-admission.js';

export type { IStartCliOptions };

/** Value-only presentation seam: the headless entry never imports the TUI implementation. */
export interface ICliPresentation {
  createThemeSurface: typeof import('./startup/theme-surface.js').createThemeSurface;
  createNodeKeybindingsSource: typeof import('@robota-sdk/agent-ui-terminal').createNodeKeybindingsSource;
  createDefaultTuiCliAdapter: typeof import('@robota-sdk/agent-ui-terminal').createDefaultTuiCliAdapter;
  renderApp: typeof import('@robota-sdk/agent-ui-terminal').renderApp;
  installTuiProcessGuards: typeof import('./process-guards.js').installTuiProcessGuards;
  setLiveChannel: typeof import('./process-guards.js').setLiveChannel;
}

export async function startCliCore(
  options: IStartCliOptions,
  createBackgroundTaskRunners: (shellExecutable?: string) => IBackgroundTaskRunner[],
  presentation?: ICliPresentation,
): Promise<void> {
  const telemetryEnvironment = takeRobotaTelemetryEnvironment();
  // Telemetry settings may hold collector credentials: they leave process.env before anything else
  // runs, so no child process inherits them. Only the supervised session launch hands them over.

  // FLOW-2006: `robota open <url>` is decided BEFORE the working directory is read and before the
  // workspace is resolved — it is the one invocation that changes which directory the process is
  // about, and resolving trust for the directory the user happened to start in would be answering
  // the wrong question. On success it has already chdir'd and stripped its two argv tokens.
  const launch = await applyLaunchInvocation();
  if (launch.kind === 'refused') return;
  const initialInput = launch.kind === 'launched' ? launch.initialInput : undefined;
  let parsedMcpArgs: IParsedCliArgs | undefined;
  if (process.argv.includes('mcp')) {
    try {
      const parsed = parseCliArgs();
      if (parsed.positional[0] === 'mcp' && parsed.positional[1] === 'serve')
        parsedMcpArgs = parsed;
    } catch {
      // The normal parser reports an invalid invocation below.
    }
  }
  const mcpOutput = parsedMcpArgs === undefined ? undefined : reserveMcpStdout();
  try {
    await runCliCore(
      options,
      createBackgroundTaskRunners,
      presentation,
      initialInput,
      mcpOutput?.protocol,
      parsedMcpArgs,
      telemetryEnvironment,
    );
  } finally {
    mcpOutput?.restore();
  }
}

async function runCliCore(
  options: IStartCliOptions,
  createBackgroundTaskRunners: (shellExecutable?: string) => IBackgroundTaskRunner[],
  presentation?: ICliPresentation,
  initialInput?: string,
  mcpProtocolStdout?: Writable,
  preParsedArgs?: IParsedCliArgs,
  telemetryEnvironment: Readonly<Record<string, string>> = {},
): Promise<void> {
  const cwd = process.cwd();
  // Issue #3082: read from argv (or the embedder's option) before anything is composed, like the
  // access decision it forces to Restricted.
  const safeMode = process.argv.includes(SAFE_MODE_FLAG) || options.safeMode === true;
  const projectAccess = await resolveStartupWorkspaceProjectAccess(
    safeMode ? [...process.argv, SAFE_MODE_FLAG] : process.argv,
    cwd,
    options,
  );
  const startupOptions: IStartCliOptions = {
    ...options,
    projectAccess,
    ...(safeMode ? { safeMode: true } : {}),
  };
  if (await runPreparsedCliCommand(startupOptions, process.argv, cwd, telemetryEnvironment)) return;

  let args: IParsedCliArgs;
  try {
    args = preParsedArgs ?? parseCliArgs();
    // One decision: the modes below read `args.safeMode`, the composition above read `safeMode`.
    args = { ...args, safeMode };
  } catch (error) {
    // allow-fallback: argument validation errors are terminal — exit is the correct response
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const version = readVersion();
  const mcpServe = args.positional[0] === 'mcp' && args.positional[1] === 'serve';
  if (args.positional[0] === 'mcp' && (!mcpServe || args.positional.length !== 2)) {
    throw new Error('Usage: robota mcp serve [options]');
  }
  if (
    (args.mcpHttpTokenFile !== undefined || args.mcpHttpPort !== undefined) &&
    (!mcpServe || (args.mcpHttpPort !== undefined && args.mcpHttpTokenFile === undefined))
  ) {
    throw new Error(
      '--http-token-file and --http-port are only valid for robota mcp serve HTTP mode',
    );
  }
  if (
    mcpServe &&
    (args.serve ||
      args.printMode ||
      args.goal !== undefined ||
      args.open ||
      args.configure ||
      args.configureProvider !== undefined ||
      args.reset)
  ) {
    throw new Error(
      'robota mcp serve cannot be combined with another process mode or setup command',
    );
  }

  if (args.help) {
    process.stdout.write(printHelp());
    return;
  }

  if (args.version) {
    process.stdout.write(`robota ${version}\n`);
    return;
  }

  if (args.checkUpdate) {
    const result = await checkForCliUpdate({ currentVersion: version, force: true });
    const message = formatCliUpdateCheckMessage(result);
    if (result.status === 'error') {
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
    process.stdout.write(`${message}\n`);
    return;
  }

  // Plugin reloads include the project scope only after the host's trust decision admits it.
  // Safe mode: no instruction files or plugins (`bare`) and no hook from any settings layer.
  const safeModeSessionOptions = safeMode
    ? ({ bare: true, skipConfiguredHooks: true } as const)
    : {};
  const reloadPluginCommandSourceInCwd = (
    registry: Parameters<typeof reloadPluginCommandSource>[0],
  ): number => reloadPluginCommandSource(registry, cwd, projectAccess, !safeMode);
  const terminal = new PrintTerminal();

  if (args.reset) {
    // Destructive-action contract (CLI-070): confirm in TTY, require --yes otherwise.
    process.exitCode = await runResetConfig(terminal, {
      yes: args.yes,
      isTTY: process.stdin.isTTY === true,
    });
    return;
  }

  if (
    (args.printMode || args.goal !== undefined || args.serve || mcpServe) &&
    // Safe mode asks for a Restricted start; the refusal exists so an untrusted project is never
    // silently run without its sources, which is exactly what safe mode requests.
    !safeMode &&
    requiresHeadlessWorkspaceTrust(projectAccess)
  ) {
    process.stderr.write(`${formatHeadlessWorkspaceTrustError(projectAccess, cwd)}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.positional[0] === 'eval') {
    // Normally unreachable — the pre-parse interceptor above handles `eval`.
    // Kept as a defensive fallthrough for non-argv invocations.
    // CLI-078 (issue #2443): `eval` is the documented shell exception to `assembleProduct` — it
    // needs no preset, packs, transports or session; see `eval-command.ts` for the equivalence boundary.
    const composition = createInitialCliWorkspaceComposition(cwd, startupOptions);
    process.exitCode = await runEvalCommand(process.argv.slice(3), cwd, {
      settingsSources: composition.settingsSources,
      projectAccess: composition.projectAccess,
    });
    return;
  }

  if (args.positional[0] === 'session' && args.positional[1] === 'analyze') {
    // Normally unreachable — the pre-parse interceptor above handles `session analyze`.
    // Kept as a defensive fallthrough for non-argv invocations.
    await runSessionAnalyze(process.argv.slice(4), cwd);
    return;
  }

  try {
    if (await runUserLocalDirectCommandIfRequested(args, cwd, terminal)) {
      return;
    }
  } catch (error) {
    // allow-fallback: user-local command failure is terminal — exit is the correct response
    terminal.writeError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // The shell's ONE preset resolution — see `resolveShellPreset` for why it is one. Resolved before
  // command setup so the preset's module-selection delta can reach `createDefaultCommandModules`.
  const userSettings = readUserSettingsOrExit();
  const settingsPreset = typeof userSettings.preset === 'string' ? userSettings.preset : undefined;
  const externalPresetLoad = safeMode ? { presets: [], errors: [] } : loadRobotaExternalPresets();
  for (const { file, error } of externalPresetLoad.errors) {
    terminal.writeError(`Skipped external preset "${file}": ${error}`);
  }
  const externalPresets: readonly IPreset[] = externalPresetLoad.presets;
  let preset: IShellPresetResolution;
  try {
    preset = resolveShellPreset(externalPresets, args, settingsPreset);
  } catch (error) {
    // allow-fallback: unknown preset id is terminal — surface available list, exit
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const resolvedPreset = preset.options;
  const selectedPresetId = preset.presetId;

  const shellExecutable = resolveRobotaShellExecutable();
  // Issues #3081, #3082: the containment choice is named, and `robota doctor` reports the same value.
  const sandbox = createRobotaSandbox({
    cwd,
    settingsSources: createInitialCliWorkspaceComposition(cwd, startupOptions).settingsSources,
  });
  const sandboxProblem = sandboxStartupProblem(sandbox);
  if (sandboxProblem !== undefined) {
    process.stderr.write(`${sandboxProblem.message}\n`);
    if (sandboxProblem.fatal) {
      process.exitCode = 1;
      return;
    }
  }
  const sandboxClient = sandbox.client;
  const { packContext, packs, packCommandModules } = createRobotaPackSet(cwd, {
    shellExecutable,
    ...(sandboxClient !== undefined ? { sandboxClient, sandboxType: ROBOTA_OS_SANDBOX_TYPE } : {}),
  });
  const keybindingsSource =
    args.printMode || args.goal !== undefined || args.serve || mcpServe || !presentation
      ? undefined
      : presentation.createNodeKeybindingsSource({
          ...createRobotaKeybindingsOptions(homedir()),
          onDiagnostic: (diagnostic) =>
            process.stderr.write(
              `Keybindings ${diagnostic.file} ${diagnostic.path}: ${diagnostic.message}\n`,
            ),
        });
  // SCREEN-2002: one registry, reaching both `/theme` (through its port) and `renderApp`.
  const theme = presentation?.createThemeSurface({
    cwd,
    projectAccess,
    userHome: homedir(),
    enabled: keybindingsSource !== undefined,
    settings: userSettings,
    reducedMotionFlag: args.reducedMotion,
    env: process.env,
  });
  const mcpStartupMode: TMcpStartupMode =
    args.printMode || args.goal ? 'print' : args.serve || mcpServe ? 'serve' : 'interactive';
  const mcp =
    options.mcpActivationAdapter === undefined && !safeMode
      ? await composeMcpClientForStartup({
          settingsSources: createInitialCliWorkspaceComposition(cwd, startupOptions)
            .settingsSources,
          projectAccess,
          cwd,
          env: process.env,
          mode: mcpStartupMode,
          ...(options.mcpStdioAuthorities === undefined
            ? {}
            : { stdioAuthorities: options.mcpStdioAuthorities }),
          ...(options.mcpApprovalStore === undefined
            ? {}
            : { approvalStore: options.mcpApprovalStore }),
          ...(options.mcpHttpTransportDeps === undefined
            ? {}
            : { httpTransportDeps: options.mcpHttpTransportDeps }),
          ...(options.mcpResultAdmissionLimits === undefined
            ? {}
            : { resultAdmissionLimits: options.mcpResultAdmissionLimits }),
          reportDiagnostic: (message) => terminal.writeError(message),
        })
      : undefined;
  if ((args.externalEventAllow?.length ?? 0) > 0 && mcp === undefined) {
    throw new Error('--external-event-allow requires the CLI-owned MCP client');
  }
  if (mcp !== undefined) startupOptions.mcpActivationAdapter = mcp.activationAdapter;
  const {
    commandHostAdapters,
    outputStyleRegistry,
    outputStyleLoadErrors,
    providerDefinitions,
    callerSuppliedProviderDefinitions,
    baseCommandModules,
    fixedCommandModules,
    startupUpdateNoticePromise,
    remoteCommandPolicy,
    workspaceComposition,
    orgPolicy,
  } = buildCommandSetupOrExit(
    cwd,
    args,
    startupOptions,
    version,
    packCommandModules,
    keybindingsSource,
    theme?.cataloguePort,
    sandbox,
  );
  for (const { file, error } of outputStyleLoadErrors) {
    terminal.writeError(`Skipped output style "${file}": ${error}`);
  }
  // SCREEN-2002: a theme file that was refused says so ONCE, here, with the path that refused it.
  // Silence would leave a user editing a file the run has already decided to ignore.
  for (const { fileName, reason } of theme?.skipped ?? []) {
    terminal.writeError(`Skipped theme "${fileName}": ${reason}`);
  }
  // Safe mode loads no user or project output style, so a saved selection of one is not applied.
  const outputStyleId = selectOutputStyleId(args, safeMode ? undefined : userSettings.outputStyle);
  let outputStyle;
  try {
    outputStyle = resolveOutputStyle(outputStyleRegistry, outputStyleId);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const outputStyleWasSelected =
    args.outputStyle !== undefined || (!safeMode && userSettings.outputStyle !== undefined);
  if (outputStyleWasSelected) {
    const outputStyleNotice = `Output style: ${outputStyle.name} (${outputStyle.id}; input cost ${outputStyle.tokenCost})`;
    if (args.printMode) {
      process.stderr.write(`${outputStyleNotice}\n`);
    } else {
      terminal.writeLine(outputStyleNotice);
    }
  }
  // REMOTE-008: the shell owns/injects transport wiring; `/remote-control` is its declarative trigger.
  const {
    registry: transportRegistry,
    wsTransport,
    bindTransports,
    usageReporters,
  } = createCliUsageTransportRegistry(
    workspaceComposition.sessionStore,
    workspaceComposition.projectAccess.status === 'trusted',
    args.open,
  );
  const externalEventHost =
    mcp && args.externalEventAllow?.length
      ? createMcpExternalEventHost(args.externalEventAllow, mcp, (message) =>
          terminal.writeLine(message),
        )
      : undefined;
  const bindTuiTransports = async (session: IInteractiveSession): Promise<void> => {
    bindTransports(session);
    if (!externalEventHost) return;
    if (!(session instanceof InteractiveSession)) {
      throw new Error('External event host requires an InteractiveSession runtime');
    }
    await externalEventHost.bind(session);
  };
  const { controller: remoteControlController, setChannel: setRemoteControlChannel } =
    createRemoteControlController(transportRegistry, usageReporters);
  // CMD-007: this product stores `/cost budget` in `.robota/budget.json`; commands see only its port.
  commandHostAdapters.costBudget = createFileCostBudgetAdapter(cwd);
  commandHostAdapters.sandbox = createSandboxCommandAdapter(sandbox, {
    read: () => readSettings(robotaUserSettingsPath()),
    write: (settings) => writeSettings(robotaUserSettingsPath(), settings),
  });
  const startPeers = attachHostAdapters(commandHostAdapters, remoteControlController, terminal);

  reportUnknownPresetModules(
    (message) => terminal.writeError(message),
    baseCommandModules,
    packCommandModules,
    resolvedPreset,
  );

  if (
    await routeProjectSetup({
      cwd,
      args,
      startOptions: startupOptions,
      terminal,
      providerDefinitions,
      workspace: workspaceComposition,
    })
  ) {
    return;
  }

  const providerOptions = args.provider
    ? { providerOverride: args.provider, providerDefinitions }
    : { providerDefinitions };
  const providerSettings = readProviderSettings(
    workspaceComposition.settingsSources,
    providerOptions,
  );
  const modelId = resolvedPreset.model ?? providerSettings.model;
  let effortResolution;
  try {
    effortResolution = resolveCliModelEffort(
      args,
      process.env,
      readMergedProviderSettings(workspaceComposition.settingsSources),
      resolvedPreset,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  commandHostAdapters.effort = createCliEffortAdapter(effortResolution);
  if (safeMode) {
    const notice = `${SAFE_MODE_NOTICE}\n`;
    if (args.printMode) process.stderr.write(notice);
    else terminal.writeLine(notice.trimEnd());
  }
  if (providerSettings.source === 'env-default' && providerSettings.sourceEnvVar !== undefined) {
    const notice = `Using ${providerSettings.name} (${modelId}) via ${providerSettings.sourceEnvVar} — run \`robota --configure\` to persist a profile.\n`;
    if (args.printMode) {
      process.stderr.write(notice);
    } else {
      terminal.writeLine(notice.trimEnd());
    }
  }
  // CLI-078 (issue #2443): these are the fold's INPUTS. The modes below never read them — they bind
  // to the identities `assembleProduct` returns (`bindAssembledCollaborators`), like every other
  // product-owned collaborator.
  const backgroundTaskRunnerInput = createBackgroundTaskRunners(shellExecutable);
  const subagentRunnerFactoryInput = createRobotaSubagentRunnerFactory({
    packContext,
    providerConfig: { ...providerSettings, model: modelId },
    providerDefinitions,
    reproduction: {
      callerSuppliedDefinitions: callerSuppliedProviderDefinitions,
      replayProvider: args.sessionLog !== undefined,
    },
    notice: (message) => process.stderr.write(`${message}\n`),
  });

  // ARCH-005 S2: the ONE composition call. Everything product-specific about `robota` is declared as DATA
  // in `createRobotaProfile` and folded by the product-neutral `assembleProduct`. What remains below is
  // product SHELL only: notices, session-resume UX, memory UX, and mode dispatch.
  //
  // INFRA-018: `--session-log` injects a replay provider that overrides settings-based construction — it
  // replays the recorded log deterministically instead of calling a model. Provider settings/model still
  // come from the configured profile (no key is ever used).
  // ARCH-109: that parenthesis was true of this process and false of its children until
  // `subagent-provider-reproduction.ts` made it hold session-wide.
  const product = assembleProduct(
    createRobotaProfile({
      version,
      agentName: resolvedPreset.agentName ?? ROBOTA_DEFAULT_AGENT_NAME,
      providerDefinitions,
      providerSettings: { ...providerSettings, model: modelId },
      ...(args.sessionLog ? { provider: loadReplayProvider(args.sessionLog) } : {}),
      preset,
      baseCommandModules,
      packs,
      backgroundTaskRunners: backgroundTaskRunnerInput,
      subagentRunnerFactory: subagentRunnerFactoryInput,
      transports: transportRegistry,
    }),
  );
  const provider = product.provider;
  // CLI-078 (issue #2443): the collaborators every mode receives are the ones assembly returned.
  const { backgroundTaskRunners: assembledBackgroundTaskRunners, subagentRunnerFactory } =
    bindAssembledCollaborators(product, {
      backgroundTaskRunners: backgroundTaskRunnerInput,
      subagentRunnerFactory: subagentRunnerFactoryInput,
    });
  // The assembled product holds the runners readonly; the framework's session options take a
  // mutable array, so hand them a copy rather than widening the product's type.
  const backgroundTaskRunners = [...assembledBackgroundTaskRunners];
  if (provider === undefined) {
    // Unreachable with robota's profile (it always supplies providerSettings) — surfaced, never silent.
    process.stderr.write('No provider could be constructed from the resolved settings.\n');
    process.exit(1);
  }

  // ARCH-007 (B1): the kernel's RUNTIME SEAM. `commandModules`, `agentDefinitions`, `toolOptions` and
  // `permissionMode` bind here; the runner collaborators bind to `product` just above (CLI-078). The one
  // surface that does NOT pass through this assembly is `robota eval`, a documented shell exception —
  // see `eval/eval-command.ts` § CLI-078 for its equivalence boundary.
  const {
    commandModules,
    agentDefinitions,
    toolOptions,
    permissionMode,
    providerErrorGuidance,
    promptFileReferenceTag,
    modelCommandToolPrefix,
    subagentHookEnvironmentNames,
    observerFailureWarningCode,
  } = buildRobotaRuntimeOptions({
    product,
    cwd,
    provider,
    selectedCommandModules: selectProductCommandModules(
      product,
      fixedCommandModules,
      resolvedPreset,
    ),
    ...(args.permissionMode !== undefined ? { permissionMode: args.permissionMode } : {}),
    projectAccess: workspaceComposition.projectAccess,
  });
  if (mcp !== undefined) toolOptions.additionalTools.push(...(await mcp.connect()));
  const advisor = composeCliAdvisor({
    flag: args.advisor,
    userSettings,
    safeMode,
    env: process.env,
    orgPolicy,
    settingsSources: [
      ...workspaceComposition.settingsSources,
      ...createRobotaUserSettingsSources(homedir()),
    ],
    providerDefinitions,
    userSettingsPath: robotaUserSettingsPath(),
  });
  commandHostAdapters.advisor = advisor.controller;
  if (advisor.tool !== undefined) toolOptions.additionalTools.push(advisor.tool);
  if (advisor.notice !== undefined) terminal.writeError(advisor.notice);
  // The session consults the same sandbox the shell tools run under, to let a confined command
  // skip the prompt when the settings say so.
  if (sandboxClient !== undefined) toolOptions.sandboxClient = sandboxClient;
  const toolCallHandoff = mcp?.buildToolCallHandoff(permissionMode);
  // A capability the merge refused (a colliding id) is reported, never silently dropped.
  for (const { kind, id, reason } of product.rejectedCapabilities) {
    terminal.writeError(`Capability ${kind} "${id}" was not composed: ${reason}.`);
  }

  const cli = { cwd, args };
  const presetSurface = buildPresetSurfaceOptions(
    resolvedPreset,
    selectedPresetId,
    permissionMode,
    cli,
    outputStyle,
    effortResolution,
  );

  const sessionStore = workspaceComposition.sessionStore;
  let resumeSessionId: string | undefined;
  let showSessionPickerOnStart = false;

  if (args.continueMode) {
    resumeSessionId = resolveLatestSessionId(sessionStore, cwd);
  } else if (args.resumeId !== undefined) {
    if (args.resumeId === '') {
      showSessionPickerOnStart = true;
    } else {
      resumeSessionId = resolveSessionIdByIdOrName(sessionStore, args.resumeId);
      if (resumeSessionId === undefined) {
        process.stderr.write(`Session not found: ${args.resumeId}\n`);
        process.exit(1);
      }
    }
  }

  // SELFHOST-008 P6: one memory switch (default OFF), resolved once and threaded into print/serve/TUI.
  // Precedence there is settings ← flag ← env (env wins). CLI-2004's screen-reader switch below is
  // deliberately the OTHER way round (the flag wins) — see both resolvers' SPEC entries.
  const memorySessionOptions = resolveMemorySurfaceOptions({
    settings: userSettings,
    args,
    memoryStore: workspaceComposition.memoryStore,
    cwd,
  });
  const screenReader = resolveScreenReaderRenderFields(
    userSettings,
    args.screenReader,
    process.env,
  );
  const livePromptTracePort = createConfiguredNodeOtlpLiveTelemetryPort(
    telemetryEnvironment,
    () => process.stderr.write('Robota telemetry export failed.\n'),
    undefined,
    {
      serviceVersion: version,
      surface: resolveLiveTelemetrySurface(args, mcpServe),
    },
    (message) => process.stderr.write(`${message}\n`),
    createCliLiveContentRedaction({
      cwd,
      projectAccess: workspaceComposition.projectAccess,
      // The startup layers and the user layers a mid-session provider switch reads.
      settingsSources: [
        ...workspaceComposition.settingsSources,
        ...createRobotaUserSettingsSources(homedir()),
      ],
      providerDefinitions,
      env: process.env,
      startupCredentials: [providerSettings.apiKey],
    }),
  );

  // GOAL-001: --goal runs an autonomous headless goal even without an explicit -p.
  if (args.printMode || args.goal) {
    const printRun = runPrintMode(
      cwd,
      args,
      provider,
      sessionStore,
      backgroundTaskRunners,
      subagentRunnerFactory,
      agentDefinitions,
      toolOptions,
      commandModules,
      commandHostAdapters,
      { resumeSessionId, forkSession: args.forkSession },
      { model: modelId, ...presetSurface },
      memorySessionOptions,
      workspaceComposition.projectAccess,
      async () => {
        await livePromptTracePort?.shutdown();
        if (mcp !== undefined) await mcp.shutdown();
      },
      orgPolicy,
      providerErrorGuidance,
      safeMode ? [] : ROBOTA_AGENT_DEFINITION_ROOTS,
      robotaPluginDirectories(cwd, homedir()),
      ROBOTA_PROJECT_SETTINGS,
      createRobotaUserSettingsSources(homedir()),
      workspaceComposition.contributionSources,
      workspaceComposition.skillRoots,
      ROBOTA_TASK_CONTEXT,
      promptFileReferenceTag,
      modelCommandToolPrefix,
      subagentHookEnvironmentNames,
      observerFailureWarningCode,
      shellExecutable,
      livePromptTracePort,
    );
    try {
      await printRun;
    } finally {
      await livePromptTracePort?.shutdown();
      if (mcp !== undefined) await mcp.shutdown();
    }
    return;
  }

  if (mcpServe) {
    if (mcpProtocolStdout === undefined) throw new Error('MCP protocol stdout was not reserved');
    const sessionOptions = buildServeSessionOptions({
      cwd,
      ...(livePromptTracePort ? { livePromptTrace: livePromptTracePort } : {}),
      args,
      provider,
      providerErrorGuidance,
      promptFileReferenceTag,
      modelCommandToolPrefix,
      subagentHookEnvironmentNames,
      observerFailureWarningCode,
      commandHookShell: shellExecutable,
      sessionStore,
      projectAccess: workspaceComposition.projectAccess,
      orgPolicy,
      backgroundTaskRunners,
      subagentRunnerFactory,
      agentDefinitions,
      agentDefinitionRoots: safeMode ? [] : ROBOTA_AGENT_DEFINITION_ROOTS,
      ...safeModeSessionOptions,
      pluginDirectories: robotaPluginDirectories(cwd, homedir()),
      projectSettingsPaths: ROBOTA_PROJECT_SETTINGS,
      userSettingsSources: createRobotaUserSettingsSources(homedir()),
      contributionSources: workspaceComposition.contributionSources,
      skillRoots: workspaceComposition.skillRoots,
      taskContext: ROBOTA_TASK_CONTEXT,
      ...toolOptions,
      ...(toolCallHandoff !== undefined ? { toolCallHandoff } : {}),
      commandModules,
      commandHostAdapters,
      transportRegistry,
      ...(remoteCommandPolicy ? { remoteCommandPolicy } : {}),
      resumeSessionId,
      model: modelId,
      preset: presetSurface,
      memorySessionOptions,
    });
    try {
      await runMcpServeMode(sessionOptions, version, mcpProtocolStdout, {
        ...(args.mcpHttpTokenFile !== undefined ? { tokenFile: args.mcpHttpTokenFile } : {}),
        ...(args.mcpHttpPort !== undefined ? { port: args.mcpHttpPort } : {}),
      });
    } finally {
      await livePromptTracePort?.shutdown();
      if (mcp !== undefined) await mcp.shutdown();
    }
    return;
  }

  // RUNTIME-001: the headless runtime host. `apps/agent-app` (GUI) spawns `robota --serve` instead of the ink
  // TUI — both the TUI and this entry drive the SAME runtime; the GUI does not control the CLI. No ink is
  // rendered; the WS sidecar is served by the shared `startRuntimeHost`. Placed after the runtime block so it
  // reuses the exact provider/session/transport assembly.
  if (args.serve) {
    const serveRun = runServeMode({
      cwd,
      ...(livePromptTracePort ? { livePromptTrace: livePromptTracePort } : {}),
      args,
      provider,
      providerErrorGuidance,
      promptFileReferenceTag,
      modelCommandToolPrefix,
      subagentHookEnvironmentNames,
      observerFailureWarningCode,
      commandHookShell: shellExecutable,
      sessionStore,
      projectAccess: workspaceComposition.projectAccess,
      orgPolicy,
      backgroundTaskRunners,
      subagentRunnerFactory,
      agentDefinitions,
      agentDefinitionRoots: safeMode ? [] : ROBOTA_AGENT_DEFINITION_ROOTS,
      ...safeModeSessionOptions,
      pluginDirectories: robotaPluginDirectories(cwd, homedir()),
      projectSettingsPaths: ROBOTA_PROJECT_SETTINGS,
      userSettingsSources: createRobotaUserSettingsSources(homedir()),
      contributionSources: workspaceComposition.contributionSources,
      skillRoots: workspaceComposition.skillRoots,
      taskContext: ROBOTA_TASK_CONTEXT,
      ...toolOptions,
      ...(toolCallHandoff !== undefined ? { toolCallHandoff } : {}),
      commandModules,
      commandHostAdapters,
      transportRegistry,
      bindTransports,
      // GUI-007 + SEC-001: point the served monitor at the live WS port AND carry the resolved auth token in
      // the `ws-url` (`?token=`) — zero-config authentication for the CLI's own localhost-origin monitor.
      getMonitorWsUrl: () => {
        if (wsTransport.boundPort === undefined) return undefined;
        const base = `ws://127.0.0.1:${wsTransport.boundPort}`;
        return wsTransport.resolvedToken
          ? `${base}?token=${encodeURIComponent(wsTransport.resolvedToken)}`
          : base;
      },
      ...(remoteCommandPolicy ? { remoteCommandPolicy } : {}),
      resumeSessionId,
      model: modelId,
      preset: presetSurface,
      memorySessionOptions,
    });
    try {
      await serveRun;
    } finally {
      await livePromptTracePort?.shutdown();
      if (mcp !== undefined) await mcp.shutdown();
    }
    return;
  }

  if (!presentation || !theme)
    throw new Error('Interactive presentation unavailable in headless runtime');
  warnIfTerminalAppOnMacOS(terminal);
  // ERR-001 G1: interactive mode only — the process must survive transient failures.
  presentation.installTuiProcessGuards();
  // CMD-004 Phase 2 (Stage B): late-bound TUI-mode process adapter (host-executed exit/restart).
  commandHostAdapters.process = createTuiProcessAdapter();
  // Issue #3081: `/cd` starts robota again in the target directory, resuming this conversation.
  commandHostAdapters.workspace = createWorkspaceMoveAdapter({
    userHome: homedir(),
    argv: argvCarryingSafeMode(process.argv.slice(2), safeMode),
    requestExit: () => commandHostAdapters.process?.requestExit('other'),
    environment: telemetryEnvironment,
  });
  if (isFirstRun()) {
    printFirstRunWelcome(terminal, screenReader);
    markOnboarded();
  }

  const tuiRun = presentation.renderApp({
    productDisplayName: 'Robota',
    ...(livePromptTracePort ? { livePromptTrace: livePromptTracePort } : {}),
    modelCommandToolPrefix,
    subagentHookEnvironmentNames,
    observerFailureWarningCode,
    commandHookShell: shellExecutable,
    promptFileReferenceTag,
    providerDefinitions,
    ...(toolCallHandoff !== undefined ? { toolCallHandoff } : {}),
    ...(initialInput !== undefined
      ? { initialInput, initialInputOrigin: 'external-link' as const }
      : {}),
    onChannelReady: createChannelReadyHandler(
      presentation.setLiveChannel,
      setRemoteControlChannel,
      startPeers,
    ),
    cwd,
    provider,
    providerErrorGuidance,
    projectAccess: workspaceComposition.projectAccess,
    orgPolicy,
    providerOverride: args.provider,
    providerType: providerSettings.name,
    modelId,
    outputStyle: presetSurface.outputStyle,
    language: args.language,
    maxTurns: args.maxTurns,
    version,
    sessionStore: args.noSessionPersistence ? undefined : sessionStore,
    disableSessionLoops: areSessionLoopsDisabled(process.env),
    resolveDefaultLoopPrompt: createLoopDefaultPromptResolver({
      projectAccess: workspaceComposition.projectAccess,
      userHome: homedir(),
    }),
    resumeSessionId,
    showSessionPickerOnStart,
    forkSession: args.forkSession,
    ...(args.movedFrom !== undefined ? { workspaceMovedFrom: args.movedFrom } : {}),
    sessionName: args.sessionName,
    backgroundTaskRunners,
    subagentRunnerFactory,
    agentDefinitions,
    agentDefinitionRoots: safeMode ? [] : ROBOTA_AGENT_DEFINITION_ROOTS,
    ...safeModeSessionOptions,
    pluginDirectories: robotaPluginDirectories(cwd, homedir()),
    projectSettingsPaths: ROBOTA_PROJECT_SETTINGS,
    baselinePermissionAllow: ROBOTA_PERMISSION_BASELINE,
    userSettingsSources: createRobotaUserSettingsSources(homedir()),
    contributionSources: workspaceComposition.contributionSources,
    skillRoots: workspaceComposition.skillRoots,
    taskContext: ROBOTA_TASK_CONTEXT,
    ...toolOptions,
    commandModules,
    commandHostAdapters,
    remoteCommandPolicy,
    shellExec: runShellCommand,
    startupUpdateNotice: resolveCliUpdateNotice(startupUpdateNoticePromise),
    transportRegistry,
    bindTransports: bindTuiTransports,
    // CMD-004 Stage C: remote-control enable/stop run HOST-side via the `remoteControl` command
    // host adapter (wired above) — no TUI-prop wiring remains.
    // SELFHOST-008 P6: surface-resolved memory fields (empty ⇒ memory OFF, today's behavior).
    ...memorySessionOptions,
    // CLI-2004: off ⇒ today's byte stream is unchanged.
    ...screenReader,
    screenReaderPacing: resolveRobotaScreenReaderPacing(process.env),
    terminalCapabilities: resolveRobotaTerminalCapabilities(process.env),
    // SCREEN-1992: the focus-reporting kill switch is the shell's; the TUI's TTY gate decides otherwise.
    focusReporting: resolveFocusReportingOverride(process.env),
    // SCREEN-1993: prompt history is a TUI-only surface (print and serve above receive no writer).
    ...resolvePromptHistoryRenderFields({
      settings: userSettings,
      env: process.env,
      access: workspaceComposition.projectAccess,
      cwd,
    }),
    cliAdapter: presentation.createDefaultTuiCliAdapter({
      providerDefinitions,
      reloadPluginCommandSource: reloadPluginCommandSourceInCwd,
      userSettingsPath: robotaUserSettingsPath(),
      settingsSources: createRobotaUserSettingsSources(),
      formatResumeCommand: formatRobotaResumeCommand,
    }),
    reloadPluginCommandSource: reloadPluginCommandSourceInCwd,
    keybindingsSource,
    // SCREEN-2002: the same registry the `/theme` command lists from, so a switch and a listing can
    // never disagree about which themes exist.
    themeRegistry: theme.registry,
    reducedMotion: theme.reducedMotion,
    reducedMotionOverride: theme.reducedMotionOverride,
    ...toSessionOptions(presetSurface),
  });
  try {
    await tuiRun;
  } finally {
    externalEventHost?.close();
    await livePromptTracePort?.shutdown();
    if (mcp !== undefined) await mcp.shutdown();
  }
  process.exit(0);
}
