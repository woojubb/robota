/**
 * CLI entry point — pure composition root.
 * Parses arguments and delegates to startup modules, mode runners, and transports.
 */

import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrintTerminal } from '@robota-sdk/agent-transport/headless';
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
import { promptInput } from './utils/cli-input.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from './utils/provider-default-definitions.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './startup/provider-startup.js';
import { TuiTransport, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport/tui';
import { createDefaultTransportRegistry } from '@robota-sdk/agent-transport';
import { createDefaultBackgroundTaskRunners } from '@robota-sdk/agent-executor';
import { createChildProcessSubagentRunnerFactory } from './subagents/index.js';
import { reloadPluginCommandSource } from './plugins/plugin-command-source-loader.js';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';
import { readVersion } from './startup/version.js';
import { resetConfig } from './startup/reset-config.js';
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

  if (args.reset) {
    resetConfig();
    return;
  }

  const cwd = process.cwd();
  const terminal = new PrintTerminal();

  try {
    if (await runUserLocalDirectCommandIfRequested(args, cwd, terminal)) {
      return;
    }
  } catch {
    // allow-fallback: user-local command failure is terminal — exit is the correct response
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
    // allow-fallback: terminal failure — not a silent fallback
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const providerOptions = args.provider
    ? { providerOverride: args.provider, providerDefinitions }
    : { providerDefinitions };
  const providerSettings = readProviderSettings(cwd, providerOptions);
  const modelId = args.model ?? providerSettings.model;
  const provider = createProviderFromSettings(cwd, args.model, providerOptions);
  const backgroundTaskRunners = createDefaultBackgroundTaskRunners();
  const paths = projectPaths(cwd);
  const subagentWorkerPath = join(
    dirname(fileURLToPath(import.meta.url)),
    'subagents',
    'child-process-subagent-worker.js',
  );
  const subagentRunnerFactory = createChildProcessSubagentRunnerFactory({
    workerPath: subagentWorkerPath,
    providerConfig: { ...providerSettings, model: modelId },
    logsDir: paths.logs,
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

  if (args.printMode) {
    await runPrintMode(
      cwd,
      args,
      provider,
      sessionStore,
      backgroundTaskRunners,
      subagentRunnerFactory,
      commandModules,
      commandHostAdapters,
    );
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
  await tuiTransport.start();
  process.exit(0);
}
