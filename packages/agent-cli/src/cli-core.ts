import { installProductProcessEnvironment } from './product/process-environment.js';
import { resolveCliRuntimeContext } from './startup/product-bootstrap.js';
import { readHostedRuntimeConfig } from './hosted/hosted-runtime-config.js';
import { runHostedRuntime } from './hosted/hosted-runtime-startup.js';

import { PrintTerminal } from './print-terminal.js';
import { readExternalEventGrantFiles } from './external-events/external-event-grant-file.js';
import { createExternalEventVerifier } from './external-events/external-event-verifier.js';
import {
  createTuiExternalEventGrants,
  createRefusalReporter,
  type ITuiExternalEventGrants,
} from './external-events/tui-external-event-grants.js';
import {
  createExternalEventHttpHost,
  type IExternalEventHttpHost,
} from './external-events/external-event-http-host.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';
import {
  resolveLatestSessionId,
  resolveReusableEmptySessionId,
  resolveSessionIdByIdOrName,
  InteractiveSession,
  createExternalEventGrantHistory,
  createUserSessionStore,
  readMergedProviderSettings,
  readSettings,
  writeSettings,
  type IBackgroundTaskRunner,
  type SessionSlot,
} from '@robota-sdk/agent-framework';
import { assembleProduct } from '@robota-sdk/agent-product';

import { createFileCostBudgetAdapter } from './startup/cost-budget-adapter.js';
import { applyModelFallbackChain } from './startup/model-fallback-startup.js';
import { createSetupPlaceholderProvider } from './startup/setup-placeholder-provider.js';
import { readCliProviderSettings } from './startup/provider-startup.js';
import { checkForCliUpdate, formatCliUpdateCheckMessage } from './update-check/update-check.js';
import { resolveCliUpdateNotice } from './update-check/resolve-cli-update-notice.js';
import { parseCliArgs, printHelp, subcommandWord, type IParsedCliArgs } from './utils/cli-args.js';
import { optionArgv } from './utils/option-argv.js';
import { isSubcommandName } from './utils/cli-help.js';
import { resolveShellPresetOrExit } from './startup/preset-selection.js';
import { productPluginDirectories } from './product/plugin-paths.js';
import {
  createProductSandbox,
  createSandboxCommandAdapter,
  sandboxStartupProblem,
} from './product/execution-containment.js';
import {
  createProductUserSettingsSources,
  productUserSettingsPath,
} from './product/user-settings.js';
import { readUserSettingsOrExit } from './startup/user-settings.js';
import { runShellCommand } from './startup/shell-exec.js';
import { commandEnvironment } from './product/command-environment.js';
import { admitStartupTrustDecision } from './startup/admit-trust-decision.js';
import {
  buildPresetSurfaceOptions,
  toSessionOptions,
  withAppendedSystemPrompt,
} from './startup/preset-surface-options.js';
import { createCliEffortAdapter, resolveCliModelEffort } from './startup/effort-resolution.js';
import { resolveOutputStyle, selectOutputStyleId } from './startup/output-style-selection.js';
import { bindAssembledCollaborators } from './product/assembled-collaborators.js';
import { createSelectedProductProfile } from './product/product-profile.js';
import {
  buildProductRuntimeOptions,
  loadReplayProvider,
  reportUnknownPresetModules,
  selectProductCommandModules,
  createChannelReadyHandler,
} from './product/runtime-plumbing.js';
import { createSettingsReporter } from './product/settings-reporter.js';
import { createRemoteControlController } from './remote-control/index.js';
import { createDeviceMeshHost, startDeviceListReissue } from './devices/index.js';
import { createCliUsageTransportRegistry } from './usage/usage-transport-registry.js';
import { createConfiguredNodeOtlpLiveTelemetryPort } from './telemetry/live-trace-otlp.js';
import { takeProductTelemetryEnvironment } from './telemetry/live-telemetry-env.js';
import { resolveLiveTelemetrySurface } from './telemetry/live-resource.js';
import { createCliLiveContentRedaction } from './telemetry/live-content-secrets.js';
import {
  createProductPackSet,
  OS_SANDBOX_TYPE,
  createProductSubagentRunnerFactory,
} from './product/subagent-composition.js';
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
  RESTRICTED_WORKSPACE_FLAG,
  resolveStartupWorkspaceProjectAccess,
  SAFE_MODE_FLAG,
  SAFE_MODE_NOTICE,
} from './startup/workspace-project-composition.js';
import { askToTrustWorkspace, startsNewTuiSession } from './startup/interactive-trust-prompt.js';
import {
  askServeOpenTrustQuestion,
  canAskServeOpenTrustQuestion,
} from './startup/headless-serve-trust-prompt.js';
import { runPreparsedCliCommand } from './startup/preparsed-command-routing.js';
import { applyLaunchInvocation } from './launch-intent/open-invocation-host.js';
import { routeProjectSetup } from './startup/project-setup-routing.js';
import { tuiInitialInputProps } from './startup/tui-initial-input.js';
import {
  mcpServeProtocolArgs,
  validateMcpServeInvocation,
} from './startup/mcp-serve-invocation.js';
import { resolveServeHttpOptions } from './utils/serve-http-args.js';
import { attachHostAdapters, createTuiProcessAdapter } from './startup/host-action-adapters.js';
import { providerHasOwnCredential } from './handoff/handoff-host-adapter.js';
import {
  argvCarryingSafeMode,
  createWorkspaceMoveAdapter,
} from './startup/workspace-move-adapter.js';
import { runPrintMode } from './modes/print-mode.js';
import { buildServeSessionOptions, runServeMode } from './modes/serve-mode.js';
import { createServeSessionDirectory } from './modes/serve-session-directory.js';
import { runMcpServeMode } from './modes/mcp-serve-mode.js';
import { reserveMcpStdout } from './modes/mcp-stdio-output.js';
import { composeMcpClientForStartup, mcpStartupModelNotice } from './startup/mcp-startup.js';
import { resolveMcpApprovalStore } from './startup/mcp-approval-file-store.js';
import { composeCliAdvisor } from './startup/advisor-composition.js';
import type { TMcpStartupMode } from './startup/mcp-startup.js';
import type { Writable } from 'node:stream';
import { resolveMemorySurfaceOptions } from './startup/memory-enablement.js';
import {
  createProductTuiCliAdapter,
  createTuiPresentationSources,
  resolveTuiRenderFields,
} from './startup/tui-presentation.js';
import { resolveScreenReaderRenderFields } from './startup/screen-reader-enablement.js';
import { resolveProductShellExecutable } from './product/shell.js';
import {
  formatHeadlessWorkspaceTrustError,
  formatHeadlessRestrictedNotice,
  requiresHeadlessWorkspaceTrust,
} from './startup/workspace-trust-admission.js';

export type { IStartCliOptions };

/** Value-only presentation seam: the headless entry never imports the TUI implementation. */
export interface ICliPresentation {
  createThemeSurface: typeof import('./startup/theme-surface.js').createThemeSurface;
  createNodeKeybindingsSource: typeof import('@robota-sdk/agent-ui-terminal').createNodeKeybindingsSource;
  createDefaultTuiCliAdapter: typeof import('@robota-sdk/agent-ui-terminal').createDefaultTuiCliAdapter;
  renderApp: typeof import('@robota-sdk/agent-ui-terminal').renderApp;
  renderSupervisedSessionView: typeof import('@robota-sdk/agent-ui-terminal').renderSupervisedSessionView;
  renderAttachedApp: typeof import('@robota-sdk/agent-ui-terminal').renderAttachedApp;
  installTuiProcessGuards: typeof import('./process-guards.js').installTuiProcessGuards;
  setLiveChannel: typeof import('./process-guards.js').setLiveChannel;
}

export async function startCliCore(
  initialOptions: IStartCliOptions,
  createBackgroundTaskRunners: (shellExecutable?: string) => IBackgroundTaskRunner[],
  presentation?: ICliPresentation,
): Promise<void> {
  const productRuntime = resolveCliRuntimeContext(initialOptions);
  installProductProcessEnvironment(productRuntime);
  // Hosted admission precedes launch handlers, project contributions, provider creation and all modes.
  if (readHostedRuntimeConfig(productRuntime.environment) !== undefined) {
    return runHostedRuntime(
      initialOptions,
      productRuntime.environment,
      productRuntime.config.identity.cliName,
    );
  }
  const options = { ...initialOptions, productRuntime };
  const telemetryInput = { ...productRuntime.environment };
  // The configured service name is product identity, not an exporter setting.
  delete telemetryInput['PRODUCT_TELEMETRY_SERVICE_NAME'];
  const telemetryEnvironment = takeProductTelemetryEnvironment(telemetryInput);
  for (const key of Object.keys(process.env)) {
    if (key === 'PRODUCT_TELEMETRY_SERVICE_NAME' || key === `${productRuntime.config.identity.envPrefix}TELEMETRY_SERVICE_NAME`) continue;
    if (key.startsWith('PRODUCT_TELEMETRY_') || key.startsWith(`${productRuntime.config.identity.envPrefix}TELEMETRY_`)) delete process.env[key];
  }
  // Telemetry settings may hold collector credentials: they leave process.env before anything else
  // runs, so no child process inherits them. Only the supervised session launch hands them over.

  // FLOW-2006: `the product open <url>` is decided BEFORE the working directory is read and before the
  // workspace is resolved — it is the one invocation that changes which directory the process is
  // about, and resolving trust for the directory the user happened to start in would be answering
  // the wrong question. On success it has already chdir'd and stripped its two argv tokens.
  const launch = await applyLaunchInvocation(productRuntime);
  if (launch.kind === 'refused') return;
  const initialInput = launch.kind === 'launched' ? launch.initialInput : undefined;
  const parsedMcpArgs = mcpServeProtocolArgs(process.argv.slice(2));
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
  const productRuntime = resolveCliRuntimeContext(options);
  const cwd = process.cwd();
  // Issue #3082: read from argv (or the embedder's option) before anything is composed, like the
  // access decision it forces to Restricted.
  const safeMode = optionArgv(process.argv).includes(SAFE_MODE_FLAG) || options.safeMode === true;
  let projectAccess = await resolveStartupWorkspaceProjectAccess(process.argv, cwd, {
    ...options,
    safeMode,
  });
  const startupOptions: IStartCliOptions = {
    ...options,
    projectAccess,
    ...(safeMode ? { safeMode: true } : {}),
  };
  if (
    await runPreparsedCliCommand(
      startupOptions,
      process.argv,
      cwd,
      telemetryEnvironment,
      presentation?.renderSupervisedSessionView,
      presentation,
    )
  )
    return;

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
  const { mcpServe, http: mcpHttp } = validateMcpServeInvocation(
    args,
    productRuntime.config.identity.cliName,
  );
  const serveHttp = resolveServeHttpOptions(args, productRuntime.environment);
  // Held by the serve options from here on. Left in the environment, every tool subprocess this
  // runtime starts would inherit the bearer that admits an HTTP client.
  delete process.env['PRODUCT_HTTP_TOKEN'];
  delete process.env[`${productRuntime.config.identity.envPrefix}HTTP_TOKEN`];

  if (args.help) {
    process.stdout.write(printHelp(productRuntime));
    return;
  }

  if (args.version) {
    process.stdout.write(`${productRuntime.config.identity.cliName} ${version}\n`);
    return;
  }

  if (args.checkUpdate) {
    const result = await checkForCliUpdate({
      productRuntime, currentVersion: version, force: true });
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
  ): number => reloadPluginCommandSource(registry, productRuntime, cwd, projectAccess, !safeMode);
  const terminal = new PrintTerminal();

  if (args.reset) {
    // Destructive-action contract (CLI-070): confirm in TTY, require --yes otherwise.
    process.exitCode = await runResetConfig(terminal, {
      productRuntime,
      yes: args.yes,
      isTTY: process.stdin.isTTY === true,
    });
    return;
  }

  if (
    (args.printMode || args.goal !== undefined || args.serve || mcpServe) &&
    // Safe mode, and a Restricted start a person chose (a background session started Restricted from
    // the session view), ask for one; the refusal exists so an untrusted project is never silently
    // run without its sources, which is exactly what they request.
    !safeMode &&
    !optionArgv(process.argv).includes(RESTRICTED_WORKSPACE_FLAG) &&
    requiresHeadlessWorkspaceTrust(projectAccess)
  ) {
    // #3282 §3: `--serve --open` opens a browser for whoever ran it — someone is at this terminal,
    // unlike every other headless start here. With a TTY to ask on, this asks instead of refusing.
    if (args.serve && args.open && canAskServeOpenTrustQuestion(projectAccess)) {
      const answer = await askServeOpenTrustQuestion(projectAccess, cwd, { productRuntime });
      if (answer.decision === 'quit') {
        process.exitCode = 1;
        return;
      }
      projectAccess = answer.access;
    } else {
      process.stderr.write(`${formatHeadlessWorkspaceTrustError(projectAccess, cwd, productRuntime.config.identity.cliName)}\n`);
      process.exitCode = 1;
      return;
    }
  }

  if (
    (args.printMode || args.goal !== undefined || args.serve || mcpServe) &&
    // Safe mode, and a Restricted start a person chose (a background session started Restricted from
    // the session view), ask for one; the refusal exists so an untrusted project is never silently
    // run without its sources, which is exactly what they request.
    !safeMode &&
    !optionArgv(process.argv).includes(RESTRICTED_WORKSPACE_FLAG) &&
    requiresHeadlessWorkspaceTrust(projectAccess)
  ) {
    // #3282 §3: `--serve --open` opens a browser for whoever ran it — someone is at this terminal,
    // unlike every other headless start here. With a TTY to ask on, this asks instead of refusing.
    if (args.serve && args.open && canAskServeOpenTrustQuestion(projectAccess)) {
      const answer = await askServeOpenTrustQuestion(projectAccess, cwd, { productRuntime });
      if (answer.decision === 'quit') {
        process.exitCode = 1;
        return;
      }
      projectAccess = answer.access;
    } else {
      process.stderr.write(
        `${formatHeadlessWorkspaceTrustError(projectAccess, cwd, productRuntime.config.identity.cliName)}\n`,
      );
      process.exitCode = 1;
      return;
    }
  }

  if (
    (args.printMode || args.goal !== undefined || args.serve || mcpServe) &&
    projectAccess.status === 'restricted'
  ) {
    process.stderr.write(
      `${formatHeadlessRestrictedNotice(productRuntime.layout.projectSettingsPaths)}\n`,
    );
  }

  if (subcommandWord(args) === 'eval') {
    // Normally unreachable — the pre-parse interceptor above handles `eval`.
    // Kept as a defensive fallthrough for non-argv invocations.
    // CLI-078 (issue #2443): `eval` is the documented shell exception to `assembleProduct` — it
    // needs no preset, packs, transports or session; see `eval-command.ts` for the equivalence boundary.
    const composition = createInitialCliWorkspaceComposition(cwd, startupOptions);
    process.exitCode = await runEvalCommand(process.argv.slice(3), cwd, {
      settingsSources: composition.settingsSources,
      projectAccess: composition.projectAccess,
      environment: productRuntime.environment,
    });
    return;
  }

  if (subcommandWord(args) === 'session' && args.positional[1] === 'analyze') {
    // Normally unreachable — the pre-parse interceptor above handles `session analyze`.
    // Kept as a defensive fallthrough for non-argv invocations.
    await runSessionAnalyze(process.argv.slice(4), cwd, undefined, createUserSessionStore(productRuntime.layout.userPaths.sessions));
    return;
  }

  try {
    if (await runUserLocalDirectCommandIfRequested(args, cwd, terminal, productRuntime)) {
      return;
    }
  } catch (error) {
    // allow-fallback: user-local command failure is terminal — exit is the correct response
    terminal.writeError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Issue #3268: a person starting a TUI session is asked, before the project is composed, rather
  // than left in a Restricted session no one mentioned.
  projectAccess = await askToTrustWorkspace(projectAccess, cwd, {
    productRuntime,
    interactive:
      startsNewTuiSession(args) && process.stdin.isTTY === true && process.stdout.isTTY === true,
    accessFixed:
      safeMode ||
      optionArgv(process.argv).includes(RESTRICTED_WORKSPACE_FLAG) ||
      options.projectAccess !== undefined,
  });
  admitStartupTrustDecision(startupOptions, projectAccess, cwd);

  // The shell's ONE preset resolution — see `resolveShellPreset` for why it is one. Resolved before
  // command setup so the preset's module-selection delta can reach `createDefaultCommandModules`.
  const userSettings = readUserSettingsOrExit(productRuntime);
  const preset = resolveShellPresetOrExit({
    args,
    settings: userSettings,
    productRuntime,
    safeMode,
    writeError: (message) => terminal.writeError(message),
  });
  const resolvedPreset = preset.options;
  const selectedPresetId = preset.presetId;

  const shellExecutable = resolveProductShellExecutable(productRuntime.environment);
  // Issues #3081, #3082: the containment choice is named, and `the product doctor` reports the same value.
  const sandbox = createProductSandbox({
    productRuntime,
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
  const { packContext, packs, packCommandModules } = createProductPackSet(cwd, productRuntime, {
    shellExecutable,
    ...(sandboxClient !== undefined ? { sandboxClient, sandboxType: OS_SANDBOX_TYPE } : {}),
  });
  const tuiSources =
    presentation === undefined
      ? undefined
      : createTuiPresentationSources(presentation, {
          enabled: !(args.printMode || args.goal !== undefined || args.serve || mcpServe),
          cwd,
          productRuntime,
          projectAccess,
          settings: userSettings,
          reducedMotionFlag: args.reducedMotion,
          env: productRuntime.environment,
        });
  const keybindingsSource = tuiSources?.keybindingsSource;
  const theme = tuiSources?.theme;
  const mcpStartupMode: TMcpStartupMode =
    args.printMode || args.goal ? 'print' : args.serve || mcpServe ? 'serve' : 'interactive';
  const mcp =
    options.mcpActivationAdapter === undefined && !safeMode
      ? await composeMcpClientForStartup({
          productRuntime,
          settingsSources: createInitialCliWorkspaceComposition(cwd, startupOptions)
            .settingsSources,
          projectAccess,
          cwd,
          env: productRuntime.environment,
          mode: mcpStartupMode,
          ...(options.mcpStdioAuthorities === undefined
            ? {}
            : { stdioAuthorities: options.mcpStdioAuthorities }),
          approvalStore: resolveMcpApprovalStore(options.mcpApprovalStore, productRuntime),
          ...(options.mcpHttpTransportDeps === undefined
            ? {}
            : { httpTransportDeps: options.mcpHttpTransportDeps }),
          ...(options.mcpResultAdmissionLimits === undefined
            ? {}
            : { resultAdmissionLimits: options.mcpResultAdmissionLimits }),
          reportDiagnostic: (message) => terminal.writeError(message),
        })
      : undefined;
  if (mcp !== undefined) startupOptions.mcpActivationAdapter = mcp.activationAdapter;
  // The device mesh: opened only by an interactive session whose user settings turn it on.
  const deviceMesh = createDeviceMeshHost({
    productRuntime, report: (message) => terminal.writeError(message) });
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
    {
      status: () => deviceMesh.status(),
      identityChanged: () => void deviceMesh.identityChanged(),
    },
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
  // #3189: a served runtime lets its clients list, start and switch the sessions it saves.
  const serveSessionDirectory =
    args.serve && !args.noSessionPersistence
      ? createServeSessionDirectory<InteractiveSession, SessionSlot<InteractiveSession>>()
      : undefined;
  // #3282 §4a: built from the SAME `commandHostAdapters`/`workspaceComposition` objects the rest of
  // this function keeps mutating (e.g. `commandHostAdapters.sandbox` below) — safe because the
  // reporter reads them lazily, per connection, long after startup finishes populating them.
  const settingsReporter = createSettingsReporter({
    commandHostAdapters,
    settingsSources: workspaceComposition.settingsSources,
    settingsStores: workspaceComposition.settingsStores,
    // #3282 §4b: the "Providers & Models" section reads/filters the same way `/model`'s wire
    // projection does — same provider definitions, same org-policy allowlist.
    providerDefinitions,
    orgPolicy,
    environment: productRuntime.environment,
  });
  // REMOTE-008: the shell owns/injects transport wiring; `/remote-control` is its declarative trigger.
  const {
    registry: transportRegistry,
    wsTransport,
    bindTransports,
    usageReporters,
  } = createCliUsageTransportRegistry(
    productRuntime,    workspaceComposition.sessionStore,
    workspaceComposition.projectAccess.status === 'trusted',
    args.open,
    serveSessionDirectory,
    args.daemon === true,
    settingsReporter,
  );
  // External-event grants (TUI only; the parser refuses them elsewhere): every file is valid, or the
  // TUI does not start. Each session the TUI binds opens them, and a refusal fails that bind.
  let tuiExternalEvents: ITuiExternalEventGrants | undefined;
  let tuiGrants: IExternalEventGrant[] = [];
  if ((args.externalEventGrantFiles?.length ?? 0) > 0) {
    try {
      tuiGrants = readExternalEventGrantFiles(args.externalEventGrantFiles ?? []);
      tuiExternalEvents = createTuiExternalEventGrants(tuiGrants, (line) =>
        terminal.writeLine(line),
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'grant refused'}\n`);
      process.exit(1);
    }
    commandHostAdapters.externalEvents = tuiExternalEvents.adapter;
  }
  // The grants' endpoint listens for the whole TUI run and delivers to whichever session is bound.
  let tuiEventEndpoint: IExternalEventHttpHost | undefined;
  if (tuiExternalEvents !== undefined) {
    const grantsForEndpoint = tuiExternalEvents;
    try {
      tuiEventEndpoint = createExternalEventHttpHost({
        grants: tuiGrants,
        receive: (grantId, delivery) => grantsForEndpoint.receive(grantId, delivery),
        countRefusal: (grantId, refusal) => grantsForEndpoint.countRefusal(grantId, refusal),
        port: args.externalEventPort ?? 0,
        ...(args.externalEventTrustedProxies !== undefined
          ? { trustedProxies: args.externalEventTrustedProxies }
          : {}),
        audit: createRefusalReporter((line) => terminal.writeLine(line)),
      });
      await tuiEventEndpoint.start();
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'External event endpoint could not start.'}\n`,
      );
      process.exit(1);
    }
  }
  const externalEvents = tuiExternalEvents;
  const bindTuiTransports = async (session: IInteractiveSession): Promise<void> => {
    bindTransports(session);
    if (externalEvents === undefined) return;
    if (!(session instanceof InteractiveSession)) {
      throw new Error('External event grants require an InteractiveSession runtime');
    }
    await externalEvents.bind(session);
  };
  const { controller: remoteControlController, setChannel: setRemoteControlChannel } =
    createRemoteControlController(transportRegistry, usageReporters, productRuntime);
  // CMD-007: this product stores `/cost budget` in `the configured project directory/budget.json`; commands see only its port.
  commandHostAdapters.costBudget = createFileCostBudgetAdapter(cwd, productRuntime);
  commandHostAdapters.sandbox = createSandboxCommandAdapter(sandbox, {
    read: () => readSettings(productUserSettingsPath(productRuntime)),
    write: (settings) => writeSettings(productUserSettingsPath(productRuntime), settings),
  });
  const startPeers = attachHostAdapters(
    commandHostAdapters,
    remoteControlController,
    terminal,
    productRuntime,
    undefined,
    {
      sessionStore: workspaceComposition.sessionStore,
      // Read when a session arrives, after the provider settings below are resolved.
      hasOwnProvider: () => providerHasOwnCredential(providerSettings, providerDefinitions),
      onHandedOff: () => commandHostAdapters.process?.requestExit('other'),
    },
    deviceMesh,
  );

  reportUnknownPresetModules(
    (message) => terminal.writeError(message),
    baseCommandModules,
    packCommandModules,
    resolvedPreset,
  );

  const projectSetup = await routeProjectSetup({
    cwd,
    args,
    startOptions: startupOptions,
    terminal,
    providerDefinitions,
    workspace: workspaceComposition,
  });
  if (projectSetup.handled) {
    return;
  }
  // #3282 §3: no usable provider, but this is `--serve` (a daemon's child is too) — continue with a
  // placeholder that never calls a model instead of the normal, validated settings read below, which
  // would throw the same "No provider configuration found" this run already tolerated.
  const setupRequired = projectSetup.setupRequired !== undefined;

  const providerSettings = setupRequired
    ? { name: 'setup-placeholder', model: 'setup-required' }
    : readCliProviderSettings(productRuntime, workspaceComposition.settingsSources, providerDefinitions, args.provider);
  const modelId = resolvedPreset.model ?? providerSettings.model;
  let effortResolution;
  try {
    effortResolution = resolveCliModelEffort(
      args,
      productRuntime.environment,
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
    const notice = `Using ${providerSettings.name} (${modelId}) via ${providerSettings.sourceEnvVar} — run \`${productRuntime.config.identity.cliName} --configure\` to persist a profile.\n`;
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
  const subagentRunnerFactoryInput = createProductSubagentRunnerFactory({
    productRuntime,
    packContext,
    providerConfig: { ...providerSettings, model: modelId },
    providerDefinitions,
    reproduction: {
      callerSuppliedDefinitions: callerSuppliedProviderDefinitions,
      replayProvider: args.sessionLog !== undefined,
    },
    notice: (message) => process.stderr.write(`${message}\n`),
  });

  // ARCH-005 S2: the ONE composition call. Everything product-specific about `the product` is declared as DATA
  // in `createSelectedProductProfile` and folded by the product-neutral `assembleProduct`. What remains below is
  // product SHELL only: notices, session-resume UX, memory UX, and mode dispatch.
  //
  // INFRA-018: `--session-log` injects a replay provider that overrides settings-based construction — it
  // replays the recorded log deterministically instead of calling a model. Provider settings/model still
  // come from the configured profile (no key is ever used).
  // ARCH-109: that parenthesis was true of this process and false of its children until
  // `subagent-provider-reproduction.ts` made it hold session-wide.
  const product = assembleProduct(
    createSelectedProductProfile({
      productRuntime,
      version,
      agentName: resolvedPreset.agentName ?? productRuntime.config.identity.displayName,
      providerDefinitions,
      providerSettings: { ...providerSettings, model: modelId },
      ...(args.sessionLog ? { provider: loadReplayProvider(args.sessionLog) } : {}),
      // #3282 §3: setup mode overrides with the same seam `--session-log` replay uses — the
      // placeholder never calls a model, so nothing below needs to construct a real one.
      ...(setupRequired ? { provider: createSetupPlaceholderProvider() } : {}),
      preset,
      baseCommandModules,
      packs,
      backgroundTaskRunners: backgroundTaskRunnerInput,
      subagentRunnerFactory: subagentRunnerFactoryInput,
      transports: transportRegistry,
    }),
  );
  // A replayed session answers from its log, so there is nothing to fall back from; a setup-mode
  // placeholder is not a provider a fallback chain could validate either.
  const provider =
    product.provider === undefined || args.sessionLog !== undefined || setupRequired
      ? product.provider
      : applyModelFallbackChain({
          provider: product.provider,
          fallbackFlag: args.fallbackModel,
          settingsSources: workspaceComposition.settingsSources,
          primaryConfig: { ...providerSettings, model: modelId },
          ...(args.provider !== undefined && { providerOverride: args.provider }),
          providerDefinitions,
          environment: productRuntime.environment,
          ...(orgPolicy !== undefined && { orgPolicy }),
          announceMoves: args.printMode,
          notice: (message) =>
            args.printMode ? process.stderr.write(`${message}\n`) : terminal.writeLine(message),
        });
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
    // Unreachable with the product's profile (it always supplies providerSettings) — surfaced, never silent.
    process.stderr.write('No provider could be constructed from the resolved settings.\n');
    process.exit(1);
  }

  // ARCH-007 (B1): the kernel's RUNTIME SEAM. `commandModules`, `agentDefinitions`, `toolOptions` and
  // `permissionMode` bind here; the runner collaborators bind to `product` just above (CLI-078). The one
  // surface that does NOT pass through this assembly is `the product eval`, a documented shell exception —
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
  } = buildProductRuntimeOptions({
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
    env: productRuntime.environment,
    orgPolicy,
    settingsSources: [
      ...workspaceComposition.settingsSources,
      ...createProductUserSettingsSources(productRuntime),
    ],
    providerDefinitions,
    userSettingsPath: productUserSettingsPath(productRuntime),
    mainProvider: { provider, config: providerSettings },
  });
  commandHostAdapters.advisor = advisor.controller;
  if (advisor.tool !== undefined) toolOptions.additionalTools.push(advisor.tool);
  if (advisor.notice !== undefined) terminal.writeError(advisor.notice);
  // The session consults the same sandbox the shell tools run under, to let a confined command
  // skip the prompt when the settings say so.
  if (sandboxClient !== undefined) toolOptions.sandboxClient = sandboxClient;
  if (options.toolExecutionPolicy !== undefined)
    toolOptions.toolExecutionPolicy = options.toolExecutionPolicy;
  const toolCallHandoff = mcp?.buildToolCallHandoff(permissionMode);
  // A capability the merge refused (a colliding id) is reported, never silently dropped.
  for (const { kind, id, reason } of product.rejectedCapabilities) {
    terminal.writeError(`Capability ${kind} "${id}" was not composed: ${reason}.`);
  }

  const cli = { cwd, args };
  const presetSurface = withAppendedSystemPrompt(
    buildPresetSurfaceOptions(
      productRuntime,
      resolvedPreset,
      selectedPresetId,
      permissionMode,
      cli,
      outputStyle,
      effortResolution,
    ),
    mcp === undefined ? undefined : mcpStartupModelNotice(mcpStartupMode, mcp.unavailableServers, productRuntime.vocabulary.cliName),
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
  } else if (args.serve && !args.noSessionPersistence) {
    // #3289 §1: a served/daemon runtime's own launch reuses an existing empty session of this
    // workspace instead of adding another one — nothing else can be bound to anything yet at
    // startup, so every empty session found here is free.
    resumeSessionId = resolveReusableEmptySessionId(sessionStore, cwd);
  }

  // SELFHOST-008 P6: one memory switch (default OFF), resolved once and threaded into print/serve/TUI.
  // Precedence there is settings ← flag ← env (env wins). CLI-2004's screen-reader switch below is
  // deliberately the OTHER way round (the flag wins) — see both resolvers' SPEC entries.
  const memorySessionOptions = resolveMemorySurfaceOptions({
    productRuntime,
    settings: userSettings,
    args,
    memoryStore: workspaceComposition.memoryStore,
    cwd,
  });
  const screenReader = resolveScreenReaderRenderFields(
    userSettings,
    args.screenReader,
    productRuntime.environment,
  );
  const livePromptTracePort = createConfiguredNodeOtlpLiveTelemetryPort(
    telemetryEnvironment,
    () => process.stderr.write(`${productRuntime.config.identity.displayName} telemetry export failed.\n`),
    undefined,
    {
      serviceVersion: version,
      telemetryServiceName: productRuntime.config.identity.telemetryServiceName,
      surface: resolveLiveTelemetrySurface(args, mcpServe),
    },
    (message) => process.stderr.write(`${message}\n`),
    createCliLiveContentRedaction({
      cwd,
      projectAccess: workspaceComposition.projectAccess,
      // The startup layers and the user layers a mid-session provider switch reads.
      settingsSources: [
        ...workspaceComposition.settingsSources,
        ...createProductUserSettingsSources(productRuntime),
      ],
      providerDefinitions,
      env: productRuntime.environment,
      startupCredentials: [providerSettings.apiKey],
    }),
  );

  // GOAL-001: --goal runs an autonomous headless goal even without an explicit -p.
  if (args.printMode || args.goal) {
    const printRun = runPrintMode(
      productRuntime,      cwd,
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
      safeMode ? [] : productRuntime.layout.agentDefinitionRoots,
      productPluginDirectories(cwd, productRuntime),
      productRuntime.layout.projectSettingsPaths,
      createProductUserSettingsSources(productRuntime),
      workspaceComposition.contributionSources,
      workspaceComposition.skillRoots,
      productRuntime.layout.taskContext,
      promptFileReferenceTag,
      modelCommandToolPrefix,
      subagentHookEnvironmentNames,
      observerFailureWarningCode,
      shellExecutable,
      livePromptTracePort,
      workspaceComposition.createEditCheckpointStore?.(),
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
      productRuntime,
      cwd,
      ...(livePromptTracePort ? { livePromptTrace: livePromptTracePort } : {}),
      args,
      provider,
      providerDefinitions,
      providerErrorGuidance,
      promptFileReferenceTag,
      modelCommandToolPrefix,
      subagentHookEnvironmentNames,
      observerFailureWarningCode,
      commandHookShell: shellExecutable,
      sessionStore,
      projectAccess: workspaceComposition.projectAccess,
      ...(workspaceComposition.createEditCheckpointStore !== undefined
        ? { createEditCheckpointStore: workspaceComposition.createEditCheckpointStore }
        : {}),
      orgPolicy,
      backgroundTaskRunners,
      subagentRunnerFactory,
      agentDefinitions,
      agentDefinitionRoots: safeMode ? [] : productRuntime.layout.agentDefinitionRoots,
      ...safeModeSessionOptions,
      pluginDirectories: productPluginDirectories(cwd, productRuntime),
      projectSettingsPaths: productRuntime.layout.projectSettingsPaths,
      userSettingsSources: createProductUserSettingsSources(productRuntime),
      contributionSources: workspaceComposition.contributionSources,
      skillRoots: workspaceComposition.skillRoots,
      taskContext: productRuntime.layout.taskContext,
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
      await runMcpServeMode(productRuntime, sessionOptions, version, mcpProtocolStdout, mcpHttp);
    } finally {
      await livePromptTracePort?.shutdown();
      if (mcp !== undefined) await mcp.shutdown();
    }
    return;
  }

  // RUNTIME-001: the headless runtime host. `apps/agent-app` (GUI) spawns `the product --serve` instead of the ink
  // TUI — both the TUI and this entry drive the SAME runtime; the GUI does not control the CLI. No ink is
  // rendered; the WS sidecar is served by the shared `startRuntimeHost`. Placed after the runtime block so it
  // reuses the exact provider/session/transport assembly.
  if (args.serve) {
    const serveRun = runServeMode({
      productRuntime,
      cwd,
      ...(livePromptTracePort ? { livePromptTrace: livePromptTracePort } : {}),
      args,
      provider,
      providerDefinitions,
      providerErrorGuidance,
      promptFileReferenceTag,
      modelCommandToolPrefix,
      subagentHookEnvironmentNames,
      observerFailureWarningCode,
      commandHookShell: shellExecutable,
      sessionStore,
      projectAccess: workspaceComposition.projectAccess,
      ...(workspaceComposition.createEditCheckpointStore !== undefined
        ? { createEditCheckpointStore: workspaceComposition.createEditCheckpointStore }
        : {}),
      orgPolicy,
      backgroundTaskRunners,
      subagentRunnerFactory,
      agentDefinitions,
      agentDefinitionRoots: safeMode ? [] : productRuntime.layout.agentDefinitionRoots,
      ...safeModeSessionOptions,
      pluginDirectories: productPluginDirectories(cwd, productRuntime),
      projectSettingsPaths: productRuntime.layout.projectSettingsPaths,
      userSettingsSources: createProductUserSettingsSources(productRuntime),
      contributionSources: workspaceComposition.contributionSources,
      skillRoots: workspaceComposition.skillRoots,
      taskContext: productRuntime.layout.taskContext,
      ...toolOptions,
      ...(toolCallHandoff !== undefined ? { toolCallHandoff } : {}),
      commandModules,
      commandHostAdapters,
      transportRegistry,
      bindTransports,
      ...(serveSessionDirectory !== undefined ? { sessionDirectory: serveSessionDirectory } : {}),
      ...(serveHttp !== undefined ? { http: serveHttp } : {}),
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
      ...(setupRequired ? { setupRequired: true } : {}),
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
  warnIfTerminalAppOnMacOS(terminal, productRuntime.environment);
  // ERR-001 G1: interactive mode only — the process must survive transient failures.
  presentation.installTuiProcessGuards();
  // CMD-004 Phase 2 (Stage B): late-bound TUI-mode process adapter (host-executed exit/restart).
  commandHostAdapters.process = createTuiProcessAdapter();
  // Issue #3081: `/cd` starts the product again in the target directory, resuming this conversation.
  commandHostAdapters.workspace = createWorkspaceMoveAdapter({
    productRuntime,
    providerDefinitions,
    userHome: productRuntime.userHome ?? productRuntime.layout.userRoot,
    argv: argvCarryingSafeMode(process.argv.slice(2), safeMode),
    requestExit: () => commandHostAdapters.process?.requestExit('other'),
    environment: telemetryEnvironment,
  });
  if (isFirstRun(productRuntime.layout.userPaths.onboarded)) {
    printFirstRunWelcome(terminal, productRuntime, screenReader);
    markOnboarded(productRuntime.layout.userPaths.onboarded);
  }
  // A device holding the signing key keeps its roster and revocation list from lapsing while it runs.
  startDeviceListReissue({
    productRuntime, onReissued: () => void deviceMesh.identityChanged() });
  // What a linked device asks that needs the operator is asked on this terminal, never in a prompt.
  void deviceMesh.start({
    ...(remoteControlController.operatorApprover !== undefined
      ? { operatorApprover: remoteControlController.operatorApprover }
      : {}),
  });

  const tuiRun = presentation.renderApp({
    productDisplayName: `${productRuntime.config.identity.displayName}`,
    ...(livePromptTracePort ? { livePromptTrace: livePromptTracePort } : {}),
    modelCommandToolPrefix,
    subagentHookEnvironmentNames,
    observerFailureWarningCode,
    commandHookShell: shellExecutable,
    promptFileReferenceTag,
    providerDefinitions,
    ...(toolCallHandoff !== undefined ? { toolCallHandoff } : {}),
    ...tuiInitialInputProps(
      initialInput,
      args.positional,
      args.literalPositionals === true ? () => false : isSubcommandName,
    ),
    onChannelReady: createChannelReadyHandler(
      presentation.setLiveChannel,
      setRemoteControlChannel,
      startPeers,
    ),
    cwd,
    provider,
    providerErrorGuidance,
    projectAccess: workspaceComposition.projectAccess,
    // A store per session: a switch may build the next session before the old one's turn ends.
    ...(workspaceComposition.createEditCheckpointStore !== undefined
      ? { createEditCheckpointStore: workspaceComposition.createEditCheckpointStore }
      : {}),
    orgPolicy,
    providerOverride: args.provider,
    providerType: providerSettings.name,
    modelId,
    outputStyle: presetSurface.outputStyle,
    language: args.language,
    maxTurns: args.maxTurns,
    version,
    sessionStore: args.noSessionPersistence ? undefined : sessionStore,
    disableSessionLoops: areSessionLoopsDisabled(productRuntime.environment),
    resolveDefaultLoopPrompt: createLoopDefaultPromptResolver({
      productRuntime,
      projectAccess: workspaceComposition.projectAccess,
      userHome: productRuntime.userHome ?? productRuntime.layout.userRoot,
    }),
    resumeSessionId,
    showSessionPickerOnStart,
    forkSession: args.forkSession,
    ...(args.movedFrom !== undefined ? { workspaceMovedFrom: args.movedFrom } : {}),
    sessionName: args.sessionName,
    backgroundTaskRunners,
    subagentRunnerFactory,
    agentDefinitions,
    agentDefinitionRoots: safeMode ? [] : productRuntime.layout.agentDefinitionRoots,
    ...safeModeSessionOptions,
    pluginDirectories: productPluginDirectories(cwd, productRuntime),
    projectSettingsPaths: productRuntime.layout.projectSettingsPaths,
    baselinePermissionAllow: productRuntime.layout.baselinePermissionAllow,
    userSettingsSources: createProductUserSettingsSources(productRuntime),
    environment: productRuntime.environment,
    contributionSources: workspaceComposition.contributionSources,
    skillRoots: workspaceComposition.skillRoots,
    taskContext: productRuntime.layout.taskContext,
    ...toolOptions,
    commandModules,
    commandHostAdapters,
    remoteCommandPolicy,
    shellExec: (command, env) => runShellCommand(command, commandEnvironment(productRuntime.environment), env),
    startupUpdateNotice: resolveCliUpdateNotice(startupUpdateNoticePromise),
    transportRegistry,
    bindTransports: bindTuiTransports,
    // One grant history for the run: every session the TUI switches to shares it (#3189).
    ...(externalEvents !== undefined
      ? {
          externalEventVerifierFactory: createExternalEventVerifier,
          externalEventGrantHistory: createExternalEventGrantHistory(),
        }
      : {}),
    // CMD-004 Stage C: remote-control enable/stop run HOST-side via the `remoteControl` command
    // host adapter (wired above) — no TUI-prop wiring remains.
    // SELFHOST-008 P6: surface-resolved memory fields (empty ⇒ memory OFF, today's behavior).
    ...memorySessionOptions,
    // CLI-2004, SCREEN-1992, SCREEN-1993: the presentation every TUI entry resolves alike.
    ...resolveTuiRenderFields({
      productRuntime,
      screenReader,
      settings: userSettings,
      env: productRuntime.environment,
      access: workspaceComposition.projectAccess,
      cwd,
    }),
    cliAdapter: createProductTuiCliAdapter(presentation.createDefaultTuiCliAdapter, {
      productRuntime,
      providerDefinitions,
      reloadPluginCommandSource: reloadPluginCommandSourceInCwd,
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
    deviceMesh.close();
    await tuiEventEndpoint?.stop();
    externalEvents?.close();
    await livePromptTracePort?.shutdown();
    if (mcp !== undefined) await mcp.shutdown();
  }
  process.exit(0);
}
