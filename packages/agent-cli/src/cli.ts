/**
 * CLI entry point — pure composition root.
 * Parses arguments and delegates to startup modules, mode runners, and transports.
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { PrintTerminal, promptInput } from '@robota-sdk/agent-transport/headless';
import {
  createProjectSessionStore,
  projectPaths,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
  readMergedProviderSettings,
  readProviderSettings,
  createProviderFromSettings,
  checkForCliUpdate,
  formatCliUpdateCheckMessage,
  formatCliUpdateNotice,
  ProviderConfigError,
  readSettings,
  getUserSettingsPath,
} from '@robota-sdk/agent-framework';
import { parseCliArgs, parseToolList, printHelp } from './utils/cli-args.js';
import type { IParsedCliArgs } from './utils/cli-args.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { resolveCliPreset, selectPresetId } from './startup/preset-selection.js';
import { DEFAULT_AGENT_NAME, loadExternalPresets } from '@robota-sdk/agent-preset';
import type { IResolvedPresetOptions } from '@robota-sdk/agent-preset';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './startup/provider-startup.js';
import { renderApp, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport-tui';
import { installTuiProcessGuards, setLiveChannel } from './process-guards.js';
import { TransportRegistry } from '@robota-sdk/agent-transport';
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import { createDefaultBackgroundTaskRunners } from '@robota-sdk/agent-executor';
import {
  createChildProcessSubagentRunnerFactory,
  getDefaultSubagentWorkerPath,
} from '@robota-sdk/agent-subagent-runner';
import { createGitWorktreeIsolationAdapter } from './subagents/git-worktree-isolation-adapter.js';
import { reloadPluginCommandSource } from '@robota-sdk/agent-command';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';
import { runSessionAnalyze } from './session-analyzer/session-analyze-command.js';
import { readVersion } from './startup/version.js';
import { runResetConfig } from './startup/reset-config.js';
import { runDiagnoseCommand } from './startup/diagnose-command.js';
import { runInitCommand } from './init/init-command.js';
import { isFirstRun, markOnboarded, printFirstRunWelcome } from './startup/first-run.js';
import { warnIfTerminalAppOnMacOS } from './startup/terminal-check.js';
import type { IStartCliOptions } from './startup/command-setup.js';
import { buildCommandSetup } from './startup/command-setup.js';
import { runPrintMode } from './modes/print-mode.js';

export type { IStartCliOptions };

/**
 * Composition-root wiring of the default transport registry. The generic registry lives in
 * `@robota-sdk/agent-transport`; choosing which concrete transports to pre-register is an
 * app-assembly decision, so the CLI (the composition root) wires `WsTransport` here rather than
 * the transport core depending on the ws package.
 */
/**
 * Load the optional session-log replay provider (INFRA-017). `@robota-sdk/agent-provider-replay` is a
 * dev/test-only package deliberately kept out of the published dependency graph, so `--session-log`
 * replay is a development capability: resolvable in the monorepo (and for anyone who installs the
 * package), and reported as unavailable — never a hard crash — in the default published CLI.
 */
function loadReplayProvider(logFile: string): IAIProvider {
  let mod: { createReplayProviderFromLogFile: (file: string) => IAIProvider };
  try {
    const requireFrom = createRequire(import.meta.url);
    mod = requireFrom('@robota-sdk/agent-provider-replay') as typeof mod;
  } catch {
    throw new Error(
      '--session-log replay requires @robota-sdk/agent-provider-replay, a dev-only package that is not bundled in the published CLI.',
    );
  }
  return mod.createReplayProviderFromLogFile(logFile);
}

function createDefaultTransportRegistry(): TransportRegistry {
  const registry = new TransportRegistry(getUserSettingsPath());
  registry.register(new WsTransport());
  return registry;
}

export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  // OBS-001: `session analyze` carries its own flags (--last/--session) that the strict
  // global parser does not know. Intercept it BEFORE parseCliArgs() so those flags reach
  // the subcommand instead of being rejected as "Unknown option".
  if (process.argv[2] === 'session' && process.argv[3] === 'analyze') {
    await runSessionAnalyze(process.argv.slice(4), process.cwd());
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

  // PRESET-002/004: thin shell — select preset id (flag > settings.preset > 'default') and forward
  // the resolved framework options. The precedence merge + posture mapping lives in
  // agent-preset.resolvePreset; the CLI owns none of that logic. Resolved before command setup so
  // the preset's module-selection delta can reach createDefaultCommandModules.
  const userSettings = readSettings(getUserSettingsPath());
  const settingsPreset = typeof userSettings.preset === 'string' ? userSettings.preset : undefined;
  // PRESET-007: register user-authored external presets (~/.robota/presets/*.json) into the
  // shared registry before resolution so `--preset <id>` and `/preset` can see them. Per-file
  // load/validation problems are non-fatal and surfaced as warnings; the run still proceeds.
  const externalPresetLoad = loadExternalPresets();
  for (const { file, error } of externalPresetLoad.errors) {
    terminal.writeError(`Skipped external preset "${file}": ${error}`);
  }
  let resolvedPreset: IResolvedPresetOptions;
  try {
    resolvedPreset = resolveCliPreset(args, settingsPreset);
  } catch (error) {
    // allow-fallback: unknown preset id is terminal — surface available list, exit
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  // PRESET-011: the selected preset id (same selection glue as resolveCliPreset) becomes the
  // session's runtime active-preset state. Pure state — no option re-application here.
  const selectedPresetId = selectPresetId(args, settingsPreset);

  const {
    commandHostAdapters,
    providerDefinitions,
    commandModules,
    unknownModuleNames,
    startupUpdateNoticePromise,
  } = buildCommandSetup(cwd, args, options, version, {
    ...(resolvedPreset.enabledCommandModules !== undefined
      ? { enabledCommandModules: resolvedPreset.enabledCommandModules }
      : {}),
    ...(resolvedPreset.disabledCommandModules !== undefined
      ? { disabledCommandModules: resolvedPreset.disabledCommandModules }
      : {}),
  });
  // INFRA-032: a preset command-module name that matched no module (a short form like "editor"
  // instead of agent-command-editor, or a typo) is surfaced as a non-fatal notice — never a silent
  // drop, never an abort — mirroring the external-preset skip reporting above.
  for (const { name, kind } of unknownModuleNames) {
    terminal.writeError(
      `Preset command-module "${name}" (${kind}) matched no module — expected the agent-command-* form; ignored.`,
    );
  }

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
  // INFRA-018: when a session log is supplied, replay it deterministically instead of calling a
  // model. Provider settings/model still come from the configured profile (no key is ever used —
  // the ReplayProvider answers every call from the recorded log).
  const provider = args.sessionLog
    ? loadReplayProvider(args.sessionLog)
    : createProviderFromSettings(cwd, resolvedPreset.model, providerOptions);
  const backgroundTaskRunners = createDefaultBackgroundTaskRunners();
  const paths = projectPaths(cwd);
  const subagentRunnerFactory = createChildProcessSubagentRunnerFactory({
    workerPath: getDefaultSubagentWorkerPath(),
    providerConfig: { ...providerSettings, model: modelId },
    logsDir: paths.logs,
    worktreeAdapter: createGitWorktreeIsolationAdapter(),
  });

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

  // GOAL-001: --goal runs an autonomous headless goal even without an explicit -p.
  if (args.printMode || args.goal) {
    await runPrintMode(
      cwd,
      args,
      provider,
      sessionStore,
      backgroundTaskRunners,
      subagentRunnerFactory,
      commandModules,
      commandHostAdapters,
      { resumeSessionId, forkSession: args.forkSession },
      {
        agentName: resolvedPreset.agentName ?? DEFAULT_AGENT_NAME,
        activePresetId: selectedPresetId,
        persona: resolvedPreset.persona,
        ...(resolvedPreset.permissionMode !== undefined
          ? { permissionMode: resolvedPreset.permissionMode }
          : {}),
        ...(resolvedPreset.enableParallelSubagents !== undefined
          ? { enableParallelSubagents: resolvedPreset.enableParallelSubagents }
          : {}),
        ...(resolvedPreset.selfVerification !== undefined
          ? { selfVerification: resolvedPreset.selfVerification }
          : {}),
      },
    );
    return;
  }

  warnIfTerminalAppOnMacOS(terminal);
  // ERR-001 G1: interactive mode only — the process must survive transient failures.
  installTuiProcessGuards();
  if (isFirstRun()) {
    printFirstRunWelcome(terminal);
    markOnboarded();
  }

  await renderApp({
    onChannelReady: (channel) => setLiveChannel(channel),
    cwd,
    provider,
    providerOverride: args.provider,
    providerType: providerSettings.name,
    modelId,
    language: args.language,
    permissionMode: args.permissionMode ?? resolvedPreset.permissionMode,
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
    commandModules,
    commandHostAdapters,
    shellExec: (command: string) =>
      execSync(command, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trimEnd(),
    startupUpdateNotice: startupUpdateNoticePromise
      ? startupUpdateNoticePromise.then((n) => (n ? formatCliUpdateNotice(n) : undefined))
      : undefined,
    transportRegistry: createDefaultTransportRegistry(),
    cliAdapter: createDefaultTuiCliAdapter({ providerDefinitions, reloadPluginCommandSource }),
    reloadPluginCommandSource,
    agentName: resolvedPreset.agentName ?? DEFAULT_AGENT_NAME,
    activePresetId: selectedPresetId,
    persona: resolvedPreset.persona,
    ...(resolvedPreset.enableParallelSubagents !== undefined
      ? { enableParallelSubagents: resolvedPreset.enableParallelSubagents }
      : {}),
    ...(resolvedPreset.selfVerification !== undefined
      ? { selfVerification: resolvedPreset.selfVerification }
      : {}),
  });
  process.exit(0);
}
