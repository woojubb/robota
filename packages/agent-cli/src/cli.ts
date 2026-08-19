/**
 * CLI entry point — pure composition root.
 * Parses arguments and delegates to startup modules, mode runners, and transports.
 */

import { execSync } from 'node:child_process';

import { PrintTerminal, promptInput } from '@robota-sdk/agent-transport/headless';
import {
  createProjectSessionStore,
  projectPaths,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
  readProviderSettings,
  checkForCliUpdate,
  formatCliUpdateCheckMessage,
  formatCliUpdateNotice,
  ProviderConfigError,
  readSettings,
  getUserSettingsPath,
} from '@robota-sdk/agent-framework';
import { assembleProduct } from '@robota-sdk/agent-product';
import { parseCliArgs, parseToolList, printHelp } from './utils/cli-args.js';
import type { IParsedCliArgs } from './utils/cli-args.js';
import { resolveShellPreset } from './startup/preset-selection.js';
import type { IShellPresetResolution } from './startup/preset-selection.js';
import { DEFAULT_AGENT_NAME, getPreset, loadExternalPresets } from '@robota-sdk/agent-preset';
import { buildPresetSurfaceOptions } from './startup/preset-surface-options.js';
import type { IPreset } from '@robota-sdk/agent-preset';
import { createRobotaProfile } from './product/robota-profile.js';
import {
  buildRobotaRuntimeOptions,
  createDefaultTransportRegistry,
  loadReplayProvider,
  reportUnknownPresetModules,
  selectProductCommandModules,
  createChannelReadyHandler,
} from './product/robota-plumbing.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './startup/provider-startup.js';
import { renderApp, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport-tui';
import { installTuiProcessGuards, setLiveChannel } from './process-guards.js';
import { createRemoteControlController } from './remote-control/index.js';
import { createDefaultBackgroundTaskRunners } from '@robota-sdk/agent-executor';
import { resolveSelfForkWorkerEntry } from './subagents/self-fork-worker-entry.js';
import {
  createRobotaChildProcessSubagentRunner,
  createRobotaPackSet,
} from './product/robota-subagent-composition.js';
import { createGitWorktreeIsolationAdapter } from './subagents/git-worktree-isolation-adapter.js';
import { reloadPluginCommandSource } from '@robota-sdk/agent-command';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';
import { runSessionAnalyze } from './session-analyzer/session-analyze-command.js';
import { runEvalCommand } from './eval/eval-command.js';
import { readVersion } from './startup/version.js';
import { runResetConfig } from './startup/reset-config.js';
import { runDiagnoseCommand } from './startup/diagnose-command.js';
import { runInitCommand } from './init/init-command.js';
import { isFirstRun, markOnboarded, printFirstRunWelcome } from './startup/first-run.js';
import { warnIfTerminalAppOnMacOS } from './startup/terminal-check.js';
import type { IStartCliOptions } from './startup/command-setup.js';
import { buildCommandSetup } from './startup/command-setup.js';
import { attachHostAdapters, createTuiProcessAdapter } from './startup/host-action-adapters.js';
import { runPrintMode } from './modes/print-mode.js';
import { runServeMode } from './modes/serve-mode.js';
import {
  buildMemorySessionOptions,
  printMemoryEnableNoticeOnce,
  readMemorySettings,
  resolveMemoryEnablement,
} from './startup/memory-enablement.js';

export type { IStartCliOptions };

export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  // OBS-001: `session analyze` carries its own flags (--last/--session) that the strict
  // global parser does not know. Intercept it BEFORE parseCliArgs() so those flags reach
  // the subcommand instead of being rejected as "Unknown option".
  if (process.argv[2] === 'session' && process.argv[3] === 'analyze') {
    await runSessionAnalyze(process.argv.slice(4), process.cwd());
    return;
  }

  // SELFHOST-011: `robota eval <definition>` carries a file path + `--threshold` the strict global parser
  // would reject. Intercept it BEFORE parseCliArgs() (like `session analyze`); the returned count maps to the
  // CI exit code (0 = pass, 1 = fail — mirrors `robota diagnose`).
  if (process.argv[2] === 'eval') {
    process.exitCode = await runEvalCommand(process.argv.slice(3), process.cwd());
    return;
  }

  let args: IParsedCliArgs;
  try {
    args = parseCliArgs();
  } catch (error) {
    // allow-fallback: argument validation errors are terminal — exit is the correct response
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const version = readVersion();

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

  const cwd = process.cwd();
  const terminal = new PrintTerminal();

  if (args.reset) {
    // Destructive-action contract (CLI-070): confirm in TTY, require --yes otherwise.
    process.exitCode = await runResetConfig(terminal, {
      yes: args.yes,
      isTTY: process.stdin.isTTY === true,
    });
    return;
  }

  if (args.positional[0] === 'diagnose') {
    // Exit contract (CLI-067): 0 = no issues, 1 = one or more failed checks.
    const failCount = await runDiagnoseCommand({ version, terminal, cwd });
    process.exitCode = failCount > 0 ? 1 : 0;
    return;
  }

  if (args.positional[0] === 'eval') {
    // Normally unreachable — the pre-parse interceptor above handles `eval`.
    // Kept as a defensive fallthrough for non-argv invocations.
    process.exitCode = await runEvalCommand(process.argv.slice(3), cwd);
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

  // PRESET-002/004/007/011 + ARCH-008: the shell's ONE preset resolution. `loadExternalPresets` reads
  // `~/.robota/presets/*.json` (per-file problems are warnings, never fatal) and also registers them into
  // agent-preset's module-global registry — which is now the in-session `/preset` DISCOVERY surface only,
  // NOT this resolution path. `resolveShellPreset` builds the kernel's per-call registry (R8) over the
  // same loaded presets and resolves the selected id over it, returning registry + id + override context
  // as one value that travels whole into the profile, so `assembleProduct` adopts that same registry. Both
  // surfaces come from this one load, so they cannot disagree (anti-split gate). Resolved before command
  // setup so the preset's module-selection delta can reach createDefaultCommandModules.
  const userSettings = readSettings(getUserSettingsPath());
  const settingsPreset = typeof userSettings.preset === 'string' ? userSettings.preset : undefined;
  const externalPresetLoad = loadExternalPresets();
  for (const { file, error } of externalPresetLoad.errors) {
    terminal.writeError(`Skipped external preset "${file}": ${error}`);
  }
  const externalPresets = externalPresetLoad.loaded
    .map((id) => getPreset(id))
    .filter((entry): entry is IPreset => entry !== undefined);
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

  const { packContext, packs, packCommandModules } = createRobotaPackSet(cwd);
  const {
    commandHostAdapters,
    providerDefinitions,
    baseCommandModules,
    fixedCommandModules,
    startupUpdateNoticePromise,
    remoteCommandPolicy,
  } = buildCommandSetup(cwd, args, options, version, packCommandModules);
  // REMOTE-008: the shell owns the transport registry + the remote-control controller (it has settings, the
  // registry, and — via onChannelReady — the live session), and injects the registry into the profile. The
  // `/remote-control` command is a declarative trigger; the enable/stop wiring + status view are here.
  const { registry: transportRegistry, wsTransport } = createDefaultTransportRegistry();
  const { controller: remoteControlController, setChannel: setRemoteControlChannel } =
    createRemoteControlController(transportRegistry);
  const startPeers = attachHostAdapters(commandHostAdapters, remoteControlController, terminal);

  reportUnknownPresetModules(
    (message) => terminal.writeError(message),
    baseCommandModules,
    packCommandModules,
    resolvedPreset,
  );

  if (args.positional[0] === 'init') {
    try {
      await runInitCommand(cwd, terminal, {
        yes: args.yes,
        onProviderSetup: async () => {
          await runInteractiveProviderSetup(cwd, args, promptInput, terminal, providerDefinitions);
        },
      });
    } catch (error) {
      // allow-fallback: init prompt failure is terminal — exit is the correct response
      terminal.writeError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    return;
  }

  if (args.configure) {
    await runInteractiveProviderSetup(cwd, args, promptInput, terminal, providerDefinitions);
    return;
  }

  if (handleProviderConfigurationArgs(cwd, args, terminal, providerDefinitions)) {
    return;
  }

  try {
    await ensureConfig(cwd, args, promptInput, terminal, providerDefinitions);
  } catch (error) {
    // allow-fallback: terminal failure — not a silent fallback
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    // Exit-code contract: provider configuration errors in print mode exit 3 so
    // automation can distinguish "reconfigure" from runtime failures (exit 1).
    process.exit(error instanceof ProviderConfigError && args.printMode ? 3 : 1);
  }

  const providerOptions = args.provider
    ? { providerOverride: args.provider, providerDefinitions }
    : { providerDefinitions };
  const providerSettings = readProviderSettings(cwd, providerOptions);
  const modelId = resolvedPreset.model ?? providerSettings.model;
  if (providerSettings.source === 'env-default' && providerSettings.sourceEnvVar !== undefined) {
    const notice = `Using ${providerSettings.name} (${modelId}) via ${providerSettings.sourceEnvVar} — run \`robota --configure\` to persist a profile.\n`;
    if (args.printMode) {
      process.stderr.write(notice);
    } else {
      terminal.writeLine(notice.trimEnd());
    }
  }
  const backgroundTaskRunners = createDefaultBackgroundTaskRunners();
  const paths = projectPaths(cwd);
  const subagentRunnerFactory = createRobotaChildProcessSubagentRunner({
    packContext,
    providerConfig: { ...providerSettings, model: modelId },
    logsDir: paths.logs,
    workerEntry: resolveSelfForkWorkerEntry(),
    worktreeAdapter: createGitWorktreeIsolationAdapter(),
  });

  // ARCH-005 S2: the ONE composition call. Everything product-specific about `robota` is declared as DATA
  // in `createRobotaProfile` and folded by the product-neutral `assembleProduct`. What remains below is
  // product SHELL only: notices, session-resume UX, memory UX, and mode dispatch.
  //
  // INFRA-018: `--session-log` injects a replay provider that overrides settings-based construction — it
  // replays the recorded log deterministically instead of calling a model. Provider settings/model still
  // come from the configured profile (no key is ever used).
  const product = assembleProduct(
    createRobotaProfile({
      version,
      agentName: resolvedPreset.agentName ?? DEFAULT_AGENT_NAME,
      providerDefinitions,
      providerSettings: { ...providerSettings, model: modelId },
      ...(args.sessionLog ? { provider: loadReplayProvider(args.sessionLog) } : {}),
      preset,
      baseCommandModules,
      packs,
      backgroundTaskRunners,
      subagentRunnerFactory,
      transports: transportRegistry,
    }),
  );
  const provider = product.provider;
  if (provider === undefined) {
    // Unreachable with robota's profile (it always supplies providerSettings) — surfaced, never silent.
    process.stderr.write('No provider could be constructed from the resolved settings.\n');
    process.exit(1);
  }

  // ARCH-007 (B1): the kernel's RUNTIME SEAM — every surface below binds to THIS one result.
  const { commandModules, agentDefinitions, toolOptions, permissionMode } =
    buildRobotaRuntimeOptions({
      product,
      cwd,
      provider,
      selectedCommandModules: selectProductCommandModules(
        product,
        fixedCommandModules,
        resolvedPreset,
      ),
      ...(args.permissionMode !== undefined ? { permissionMode: args.permissionMode } : {}),
    });
  // A capability the merge refused (a colliding id) is reported, never silently dropped.
  for (const { kind, id, reason } of product.rejectedCapabilities) {
    terminal.writeError(`Capability ${kind} "${id}" was not composed: ${reason}.`);
  }

  // ARCH-013: the preset fields every surface forwards, projected ONCE. This literal used to be
  // written out three times below — print, serve, interactive — kept in step by memory.
  const presetSurface = buildPresetSurfaceOptions(resolvedPreset, selectedPresetId, permissionMode);

  const sessionStore = createProjectSessionStore(cwd);
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

  // SELFHOST-008 P6: resolve the one memory switch (default OFF, opt-in) once and thread the resolved
  // fields into every construction site (print/serve/TUI). settings.json memory.enabled (SSOT) ←
  // --memory/--no-memory ← ROBOTA_MEMORY=1|0 (env wins). Disabled ⇒ {} injects nothing (today's behavior).
  const memoryEnablement = resolveMemoryEnablement({
    settings: readMemorySettings(userSettings),
    flagEnabled: args.memory,
    flagAutoSave: args.memoryAutoSave,
    env: process.env['ROBOTA_MEMORY'],
  });
  const memorySessionOptions = buildMemorySessionOptions(memoryEnablement, cwd);
  if (memoryEnablement.enabled) printMemoryEnableNoticeOnce(cwd);

  // GOAL-001: --goal runs an autonomous headless goal even without an explicit -p.
  if (args.printMode || args.goal) {
    await runPrintMode(
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
    );
    return;
  }

  // RUNTIME-001: the headless runtime host. `apps/agent-app` (GUI) spawns `robota --serve` instead of the ink
  // TUI — both the TUI and this entry drive the SAME runtime; the GUI does not control the CLI. No ink is
  // rendered; the WS sidecar is served by the shared `startRuntimeHost`. Placed after the runtime block so it
  // reuses the exact provider/session/transport assembly.
  if (args.serve) {
    await runServeMode({
      cwd,
      args,
      provider,
      sessionStore,
      backgroundTaskRunners,
      subagentRunnerFactory,
      agentDefinitions,
      ...toolOptions,
      commandModules,
      commandHostAdapters,
      transportRegistry,
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
    return;
  }

  warnIfTerminalAppOnMacOS(terminal);
  // ERR-001 G1: interactive mode only — the process must survive transient failures.
  installTuiProcessGuards();
  // CMD-004 Phase 2 (Stage B): late-bound TUI-mode process adapter (host-executed exit/restart).
  commandHostAdapters.process = createTuiProcessAdapter();
  if (isFirstRun()) {
    printFirstRunWelcome(terminal);
    markOnboarded();
  }

  await renderApp({
    providerDefinitions,
    onChannelReady: createChannelReadyHandler(setLiveChannel, setRemoteControlChannel, startPeers),
    cwd,
    provider,
    providerOverride: args.provider,
    providerType: providerSettings.name,
    modelId,
    language: args.language,
    // ARCH-013: `permissionMode` arrives via `...presetSurface` below, from this same value.
    maxTurns: args.maxTurns,
    allowedTools: parseToolList(args.allowedTools),
    deniedTools: parseToolList(args.deniedTools),
    version,
    sessionStore: args.noSessionPersistence ? undefined : sessionStore,
    resumeSessionId,
    showSessionPickerOnStart,
    forkSession: args.forkSession,
    sessionName: args.sessionName,
    backgroundTaskRunners,
    subagentRunnerFactory,
    agentDefinitions,
    ...toolOptions,
    commandModules,
    commandHostAdapters,
    remoteCommandPolicy,
    shellExec: (command: string) =>
      execSync(command, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trimEnd(),
    startupUpdateNotice: startupUpdateNoticePromise
      ? startupUpdateNoticePromise.then((n) => (n ? formatCliUpdateNotice(n) : undefined))
      : undefined,
    transportRegistry,
    // CMD-004 Stage C: remote-control enable/stop run HOST-side via the `remoteControl` command
    // host adapter (wired above) — no TUI-prop wiring remains.
    // SELFHOST-008 P6: surface-resolved memory fields (empty ⇒ memory OFF, today's behavior).
    ...memorySessionOptions,
    cliAdapter: createDefaultTuiCliAdapter({ providerDefinitions, reloadPluginCommandSource }),
    reloadPluginCommandSource,
    ...presetSurface,
  });
  process.exit(0);
}
