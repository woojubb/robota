/**
 * CLI entry point — thin 4-layer composition root.
 * Layer 0: pre-flight dispatch → Layer 1: config phase → Layer 2: sub-layer assembly →
 * Layer 3: runtime → Layer 4: mode / transport
 */

import { execSync } from 'node:child_process';
import { PrintTerminal, promptInput } from '@robota-sdk/agent-transport/headless';
import {
  createAgentRuntime,
  createProjectSessionStore,
  projectPaths,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
  readProviderSettings,
  createProviderFromSettings,
  formatCliUpdateNotice,
  getStartupCliUpdateNotice,
  shouldRunStartupCliUpdateCheck,
} from '@robota-sdk/agent-framework';
import { parseCliArgs } from './utils/cli-args.js';
import type { IParsedCliArgs } from './utils/cli-args.js';
import { TuiTransport, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport/tui';
import { createDefaultTransportRegistry } from '@robota-sdk/agent-transport';
import { handlePreflightCommands } from './startup/preflight.js';
import {
  toConfigPhaseOptions,
  toSessionRunOptions,
  toUserLocalCommandOptions,
  toStartupUpdatePolicyOptions,
} from './startup/args-to-options.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './startup/provider-startup.js';
import type { IStartCliOptions } from './startup/command-setup.js';
import { createCommandSetup } from './startup/command-setup.js';
import { createSubagentSetup } from './startup/subagent-setup.js';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';
import { readVersion } from './startup/version.js';
import { runPrintMode } from './modes/print-mode.js';

export type { IStartCliOptions };

export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  let args: IParsedCliArgs;
  try {
    // allow-fallback: argument validation errors are terminal — exit is the correct response
    args = parseCliArgs();
  } catch (error) {
    // allow-fallback: argument validation errors are terminal — exit is the correct response
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const version = readVersion();
  const terminal = new PrintTerminal();

  // Layer 0: pre-flight — single point for all early-exit commands
  if ((await handlePreflightCommands(args, { version, terminal })).handled) return;

  const cwd = process.cwd();

  // Layer 1: convert raw args to typed option objects — IParsedCliArgs boundary
  const configPhaseOpts = toConfigPhaseOptions(args);
  const sessionOpts = toSessionRunOptions(args);
  const updatePolicy = toStartupUpdatePolicyOptions(args);

  try {
    // allow-fallback: user-local command failure is terminal — exit is the correct response
    if (
      await runUserLocalDirectCommandIfRequested(toUserLocalCommandOptions(args), cwd, terminal)
    ) {
      return;
    }
  } catch (error) {
    // allow-fallback: user-local command failure is terminal — exit is the correct response
    terminal.writeError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Layer 2: sub-layer assembly (same-level grouping)
  const commandSetup = createCommandSetup(cwd, options);

  if (args.configure) {
    await runInteractiveProviderSetup(
      cwd,
      configPhaseOpts,
      promptInput,
      terminal,
      commandSetup.providerDefinitions,
    );
    return;
  }

  if (
    handleProviderConfigurationArgs(
      cwd,
      configPhaseOpts,
      terminal,
      commandSetup.providerDefinitions,
    )
  ) {
    return;
  }

  try {
    // allow-fallback: terminal failure — not a silent fallback
    await ensureConfig(
      cwd,
      configPhaseOpts,
      promptInput,
      terminal,
      commandSetup.providerDefinitions,
    );
  } catch (error) {
    // allow-fallback: terminal failure — not a silent fallback
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const providerOptions = args.provider
    ? { providerOverride: args.provider, providerDefinitions: commandSetup.providerDefinitions }
    : { providerDefinitions: commandSetup.providerDefinitions };
  const providerSettings = readProviderSettings(cwd, providerOptions);
  const modelId = args.model ?? providerSettings.model;
  const provider = createProviderFromSettings(cwd, args.model, providerOptions);

  const paths = projectPaths(cwd);
  const subagentSetup = createSubagentSetup({
    providerConfig: { ...providerSettings, model: modelId },
    logsDir: paths.logs,
  });

  const sessionStore = sessionOpts.noSessionPersistence
    ? undefined
    : createProjectSessionStore(cwd);
  let resumeSessionId: string | undefined;
  let showSessionPickerOnStart = false;

  if (sessionOpts.continueMode) {
    resumeSessionId = resolveLatestSessionId(sessionStore, cwd);
  } else if (sessionOpts.resumeId !== undefined) {
    if (sessionOpts.resumeId === '') {
      showSessionPickerOnStart = true;
    } else {
      resumeSessionId = resolveSessionIdByIdOrName(sessionStore, sessionOpts.resumeId);
      if (resumeSessionId === undefined) {
        process.stderr.write(`Session not found: ${sessionOpts.resumeId}\n`);
        process.exit(1);
      }
    }
  }

  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(updatePolicy)
    ? getStartupCliUpdateNotice({ currentVersion: version })
    : undefined;

  // Layer 3: runtime assembly — grouped same-level objects
  const runtime = createAgentRuntime({
    cwd,
    provider,
    commandModules: commandSetup.commandModules,
    commandHostAdapters: commandSetup.commandHostAdapters,
    reloadPluginCommandSource: commandSetup.reloadPluginCommandSource,
    subagentRunnerFactory: subagentSetup.subagentRunnerFactory,
    sessionStore,
    transportRegistry: createDefaultTransportRegistry(),
  });

  // Layer 4: mode / transport
  if (args.printMode) {
    await runPrintMode(sessionOpts, runtime);
    return;
  }

  const tuiTransport = new TuiTransport({
    runtime,
    providerOverride: args.provider,
    providerType: providerSettings.name,
    modelId,
    language: args.language,
    permissionMode: sessionOpts.permissionMode,
    maxTurns: sessionOpts.maxTurns,
    version,
    resumeSessionId,
    showSessionPickerOnStart,
    forkSession: sessionOpts.forkSession,
    sessionName: sessionOpts.sessionName,
    shellExec: (command: string) =>
      execSync(command, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trimEnd(),
    startupUpdateNotice: startupUpdateNoticePromise
      ? startupUpdateNoticePromise.then((n) => (n ? formatCliUpdateNotice(n) : undefined))
      : undefined,
    cliAdapter: createDefaultTuiCliAdapter({
      providerDefinitions: commandSetup.providerDefinitions,
      reloadPluginCommandSource: commandSetup.reloadPluginCommandSource,
    }),
    agentName: 'robota-cli',
  });
  await tuiTransport.start();
  process.exit(0);
}
