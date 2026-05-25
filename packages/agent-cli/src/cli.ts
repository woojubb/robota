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
  readMergedProviderSettings,
  readProviderSettings,
  createProviderFromSettings,
  checkForCliUpdate,
  formatCliUpdateCheckMessage,
  formatCliUpdateNotice,
} from '@robota-sdk/agent-framework';
import { parseCliArgs, printHelp } from './utils/cli-args.js';
import type { IParsedCliArgs } from './utils/cli-args.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './startup/provider-startup.js';
import { TuiTransport, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport/tui';
import { createDefaultTransportRegistry } from '@robota-sdk/agent-transport';
import { createDefaultBackgroundTaskRunners } from '@robota-sdk/agent-executor';
import {
  createChildProcessSubagentRunnerFactory,
  getDefaultSubagentWorkerPath,
} from '@robota-sdk/agent-subagent-runner';
import { reloadPluginCommandSource } from '@robota-sdk/agent-command';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';
import { readVersion } from './startup/version.js';
import { runResetConfig } from './startup/reset-config.js';
import type { IStartCliOptions } from './startup/command-setup.js';
import { buildCommandSetup } from './startup/command-setup.js';
import { runPrintMode } from './modes/print-mode.js';

export type { IStartCliOptions };

export async function startCli(options: IStartCliOptions = {}): Promise<void> {
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
    runResetConfig(terminal);
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

  const { commandHostAdapters, providerDefinitions, commandModules, startupUpdateNoticePromise } =
    buildCommandSetup(cwd, args, options, version);

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
    // allow-fallback: argument validation errors are terminal — exit is the correct response
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

  const providerOptions = args.provider
    ? { providerOverride: args.provider, providerDefinitions }
    : { providerDefinitions };
  const providerSettings = readProviderSettings(cwd, providerOptions);
  const modelId = args.model ?? providerSettings.model;
  const provider = createProviderFromSettings(cwd, args.model, providerOptions);
  const backgroundTaskRunners = createDefaultBackgroundTaskRunners();
  const paths = projectPaths(cwd);
  const subagentRunnerFactory = createChildProcessSubagentRunnerFactory({
    workerPath: getDefaultSubagentWorkerPath(),
    providerConfig: { ...providerSettings, model: modelId },
    logsDir: paths.logs,
  });

  const sessionStore = createProjectSessionStore(cwd);
  let resumeSessionId: string | undefined;
  let showSessionPickerOnStart = false;

  // Pre-preflight: create commandSetup early so init can offer inline provider setup
  const commandSetup = createCommandSetup(cwd, options);
  const configPhaseOpts = toConfigPhaseOptions(args);

  // Layer 0: pre-flight — single point for all early-exit commands
  if (
    (
      await handlePreflightCommands(args, {
        version,
        terminal,
        cwd,
        onProviderSetup: () =>
          runInteractiveProviderSetup(
            cwd,
            configPhaseOpts,
            promptInput,
            terminal,
            commandSetup.providerDefinitions,
          ),
      })
    ).handled
  )
    return;

  if (args.apiKey) {
    process.stderr.write(
      '\n⚠  Warning: --api-key value may appear in your shell history.\n' +
        '   Prefer: export ANTHROPIC_API_KEY=<key>, or use --api-key-env ANTHROPIC_API_KEY\n\n',
    );
  }

  // Layer 1: IParsedCliArgs → typed option objects (boundary)
  const sessionOpts = toSessionRunOptions(args);

  try {
    if (await runUserLocalDirectCommandIfRequested(toUserLocalCommandOptions(args), cwd, terminal))
      return;
  } catch (error) {
    // allow-fallback: user-local command failure is terminal
    terminal.writeError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Layer 2: sub-layer assembly (same-level grouping)
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const configPhase = await handleConfigPhase(cwd, configPhaseOpts, commandSetup, terminal, isTTY);
  if (configPhase.handled) return;

  const providerSetup = createProviderSetup(cwd, configPhaseOpts, commandSetup);
  const sessionSetup = createSessionSetup(cwd, sessionOpts);

  const { orgPolicy } = commandSetup;
  if (
    orgPolicy?.allowedProviders &&
    providerSetup.activeProfileName &&
    !orgPolicy.allowedProviders.includes(providerSetup.activeProfileName)
  ) {
    const contact = orgPolicy.adminContact
      ? `\nContact your administrator: ${orgPolicy.adminContact}`
      : '';
    terminal.writeError(
      `Provider "${providerSetup.activeProfileName}" is not allowed by your organization policy. Allowed: ${orgPolicy.allowedProviders.join(', ')}.${contact}`,
    );
    process.exit(1);
  }

  // Layer 3: runtime assembly
  const runtime = createAgentRuntime({
    cwd,
    provider: providerSetup.provider,
    commandModules: commandSetup.commandModules,
    commandHostAdapters: commandSetup.commandHostAdapters,
    reloadPluginCommandSource: commandSetup.reloadPluginCommandSource,
    subagentRunnerFactory: providerSetup.subagentRunnerFactory,
    sessionStore: sessionSetup.sessionStore,
    transportRegistry: createDefaultTransportRegistry(),
    orgPolicy: orgPolicy ?? undefined,
  });

  // Layer 4: mode / transport
  if (configPhaseOpts.printMode) {
    await runPrintMode(sessionOpts, runtime);
    return;
  }

  const tuiTransport = new TuiTransport({
    cwd,
    provider,
    providerOverride: args.provider,
    providerType: providerSettings.name,
    modelId,
    language: args.language,
    permissionMode: args.permissionMode,
    maxTurns: args.maxTurns,
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
    agentName: 'robota-cli',
  });
  process.exit(0);
}
