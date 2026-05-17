/**
 * CLI entry point — parses arguments, creates provider, and starts the Ink TUI.
 *
 * CLI composes provider definitions. SDK owns everything else
 * (config, context, session, tools).
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrintTerminal } from './print-terminal.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { findProviderDefinition } from '@robota-sdk/agent-framework';
import type { IProviderDefinition } from '@robota-sdk/agent-framework';
import { createAgentCommandModule } from '@robota-sdk/agent-command';
import { createBackgroundCommandModule } from '@robota-sdk/agent-command';
import { createProviderCommandModule } from '@robota-sdk/agent-command';
import { createCompactCommandModule } from '@robota-sdk/agent-command';
import { createContextCommandModule } from '@robota-sdk/agent-command';
import { createExitCommandModule } from '@robota-sdk/agent-command';
import { createHelpCommandModule } from '@robota-sdk/agent-command';
import { createLanguageCommandModule } from '@robota-sdk/agent-command';
import { createMemoryCommandModule } from '@robota-sdk/agent-command';
import { createModelCommandModule } from '@robota-sdk/agent-command';
import { createPermissionsCommandModule } from '@robota-sdk/agent-command';
import { createPluginCommandModule } from '@robota-sdk/agent-command';
import { createResetCommandModule } from '@robota-sdk/agent-command';
import { createRewindCommandModule } from '@robota-sdk/agent-command';
import { createStatusLineCommandModule } from '@robota-sdk/agent-command';
import { createSessionCommandModule } from '@robota-sdk/agent-command';
import { createSkillsCommandModule } from '@robota-sdk/agent-command';
import { createUserLocalCommandModule } from '@robota-sdk/agent-command';
import { createModeCommandModule } from '@robota-sdk/agent-command';
import { createSettingsCommandModule } from '@robota-sdk/agent-command';
import {
  InteractiveSession,
  createProjectSessionStore,
  projectPaths,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
} from '@robota-sdk/agent-framework';
import type {
  ICommandHostAdapters,
  ICommandModule,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import { parseCliArgs, printHelp } from './utils/cli-args.js';
import type { IParsedCliArgs } from './utils/cli-args.js';
import { promptInput } from './utils/cli-input.js';
import {
  getUserSettingsPath,
  deleteSettings,
  readSettings,
  writeSettings,
} from '@robota-sdk/agent-framework';
import {
  createProviderFromSettings,
  readMergedProviderSettings,
  readProviderSettings,
} from './utils/provider-factory.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from './utils/provider-default-definitions.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './utils/provider-setup.js';
import { resolveProviderSettingsWriteTargetPath } from '@robota-sdk/agent-framework';
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
import { WsTransport } from '@robota-sdk/agent-transport/ws';
import { TuiTransport } from '@robota-sdk/agent-transport/tui';
import type { ITuiCliAdapter } from '@robota-sdk/agent-transport/tui';
import { TransportRegistry } from './transports/transport-registry.js';
import {
  createDefaultBackgroundTaskRunners,
  type IBackgroundTaskRunner,
} from '@robota-sdk/agent-executor';
import { createChildProcessSubagentRunnerFactory } from './subagents/index.js';
import {
  checkForCliUpdate,
  formatCliUpdateCheckMessage,
  formatCliUpdateNotice,
  getStartupCliUpdateNotice,
  shouldRunStartupCliUpdateCheck,
  resolveGitBranch,
} from '@robota-sdk/agent-framework';
import type { ICliUpdateNotice } from '@robota-sdk/agent-framework';
import { applyStatusLineSettings } from '@robota-sdk/agent-framework';
import { applyActiveModelChange } from '@robota-sdk/agent-framework';
import { reloadPluginCommandSource } from './plugins/plugin-command-source-loader.js';
import { createCliPluginCommandAdapter } from './plugins/plugin-command-adapter.js';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';

/** Read version from package.json at runtime. */
function readVersion(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const dir = dirname(thisFile);
    const candidates = [join(dir, '..', '..', 'package.json'), join(dir, '..', 'package.json')];

    for (const pkgPath of candidates) {
      try {
        const raw = readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw) as { version?: string; name?: string };
        if (pkg.version !== undefined && pkg.name !== undefined) {
          return pkg.version;
        }
      } catch {
        // try next candidate
      }
    }
    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readTaskFilePrompt(cwd: string, taskFile: string): string {
  const taskPath = resolve(cwd, taskFile);
  const content = readFileSync(taskPath, 'utf8').trim();
  if (content.length === 0) {
    throw new Error(`Task file is empty: ${taskFile}`);
  }
  return `Task file (${taskFile}):\n${content}`;
}

/** Delete user settings and exit. */
function resetConfig(): void {
  const userPath = getUserSettingsPath();
  if (deleteSettings(userPath)) {
    process.stdout.write(`Deleted ${userPath}\n`);
  } else {
    process.stdout.write('No user settings found.\n');
  }
}

/**
 * Main CLI orchestration function.
 */
export interface IStartCliOptions {
  commandModules?: readonly ICommandModule[];
  providerDefinitions?: readonly IProviderDefinition[];
}

export interface ICreateDefaultCliCommandModulesOptions {
  cwd: string;
  providerDefinitions: readonly IProviderDefinition[];
}

export function createDefaultCliCommandModules({
  cwd,
  providerDefinitions,
}: ICreateDefaultCliCommandModulesOptions): readonly ICommandModule[] {
  return [
    createSkillsCommandModule({ cwd }),
    createHelpCommandModule(),
    createAgentCommandModule(),
    createModelCommandModule({
      providerDefinitions,
      settings: {
        readMergedSettings: () => readMergedProviderSettings(cwd),
      },
    }),
    createPermissionsCommandModule(),
    createModeCommandModule(),
    createLanguageCommandModule(),
    createBackgroundCommandModule(),
    createMemoryCommandModule(),
    createUserLocalCommandModule(),
    createCompactCommandModule(),
    createContextCommandModule(),
    createExitCommandModule(),
    createSessionCommandModule(),
    createResetCommandModule(),
    createRewindCommandModule(),
    createStatusLineCommandModule(),
    createPluginCommandModule(),
    createSettingsCommandModule(),
    createProviderCommandModule({
      providerDefinitions,
      settings: {
        readMergedSettings: () => readMergedProviderSettings(cwd),
        readTargetSettings: () =>
          readSettings(resolveProviderSettingsWriteTargetPath(cwd)) as TProviderSettingsDocument,
        writeTargetSettings: (settings) =>
          writeSettings(resolveProviderSettingsWriteTargetPath(cwd), settings),
      },
    }),
  ];
}

interface ICliSetup {
  commandHostAdapters: ICommandHostAdapters;
  providerDefinitions: readonly IProviderDefinition[];
  commandModules: readonly ICommandModule[];
  startupUpdateNoticePromise: Promise<ICliUpdateNotice | undefined> | undefined;
}

function buildCommandSetup(
  cwd: string,
  args: IParsedCliArgs,
  options: IStartCliOptions,
  version: string,
): ICliSetup {
  const commandHostAdapters: ICommandHostAdapters = {
    settings: {
      read: () => readSettings(getUserSettingsPath()),
      write: (settings) => writeSettings(getUserSettingsPath(), settings),
    },
    plugin: createCliPluginCommandAdapter(cwd),
  };
  const providerDefinitions = options.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS;
  const commandModules: readonly ICommandModule[] = [
    ...createDefaultCliCommandModules({ cwd, providerDefinitions }),
    ...(options.commandModules ?? []),
  ];
  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(args)
    ? getStartupCliUpdateNotice({ currentVersion: version })
    : undefined;
  return { commandHostAdapters, providerDefinitions, commandModules, startupUpdateNoticePromise };
}

function buildAppendSystemPrompt(cwd: string, args: IParsedCliArgs): string | undefined {
  const appendParts: string[] = [];
  if (args.appendSystemPrompt) appendParts.push(args.appendSystemPrompt);
  if (args.taskFile) {
    try {
      appendParts.push(readTaskFilePrompt(cwd, args.taskFile));
    } catch (error) {
      // allow-fallback: terminal failure — task file read failure exits process
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }
  if (args.jsonSchema)
    appendParts.push(
      `Respond with valid JSON only, matching this JSON schema:\n${args.jsonSchema}`,
    );
  return appendParts.length > 0 ? appendParts.join('\n\n') : undefined;
}

async function runPrintMode(
  cwd: string,
  args: IParsedCliArgs,
  provider: IAIProvider,
  sessionStore: ReturnType<typeof createProjectSessionStore>,
  backgroundTaskRunners: IBackgroundTaskRunner[],
  subagentRunnerFactory: ReturnType<typeof createChildProcessSubagentRunnerFactory>,
  commandModules: readonly ICommandModule[],
  commandHostAdapters: ICommandHostAdapters,
): Promise<void> {
  let prompt = args.positional.join(' ').trim();

  // Stdin pipe: read from stdin if no positional args and stdin is piped
  if (!prompt && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    prompt = Buffer.concat(chunks).toString('utf-8').trim();
  }

  if (!prompt) {
    process.stderr.write('Print mode (-p) requires a prompt argument.\n');
    process.exit(1);
  }

  const appendSystemPrompt = buildAppendSystemPrompt(cwd, args);

  // TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
  if (args.systemPrompt) {
    process.stderr.write('Warning: --system-prompt is not yet functional and will be ignored.\n');
  }

  const shellExec = (command: string) =>
    execSync(command, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();

  const session = new InteractiveSession({
    cwd,
    provider,
    permissionMode: args.permissionMode ?? 'bypassPermissions',
    maxTurns: args.maxTurns,
    sessionStore: args.noSessionPersistence ? undefined : sessionStore,
    sessionName: args.sessionName,
    bare: args.bare || undefined,
    allowedTools: args.allowedTools
      ? args.allowedTools
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined,
    appendSystemPrompt,
    backgroundTaskRunners,
    subagentRunnerFactory,
    commandModules,
    commandHostAdapters,
    shellExec,
    agentName: 'robota-cli',
  });

  const transport = createHeadlessTransport({
    outputFormat: args.outputFormat ?? 'text',
    prompt,
  });
  session.attachTransport(transport);
  await transport.start();
  await session.shutdown({ reason: 'prompt_input_exit', message: 'Headless transport complete' });
  process.exit(transport.getExitCode());
}

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

  // CLI resolves the active provider profile through injected provider definitions.
  const providerOptions = args.provider
    ? { providerOverride: args.provider, providerDefinitions }
    : { providerDefinitions };
  const activeProviderSettings = readMergedProviderSettings(cwd);
  const providerProfileName = args.provider ?? activeProviderSettings.currentProvider;
  const providerSettings = readProviderSettings(cwd, providerOptions);
  const modelId = args.model ?? providerSettings.model;
  const provider: IAIProvider = createProviderFromSettings(cwd, args.model, providerOptions);
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

  // Session management
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

  // Interactive TUI mode (Ink)
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
    transportRegistry: createTransportRegistry(),
    cliAdapter: createTuiCliAdapter(providerDefinitions),
    reloadPluginCommandSource,
    agentName: 'robota-cli',
  });
  await tuiTransport.start();
  process.exit(0);
}

function createTuiCliAdapter(providerDefinitions: readonly IProviderDefinition[]): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => getUserSettingsPath(),
    readSettings: (path) => readSettings(path),
    writeSettings: (path, settings) => writeSettings(path, settings),
    deleteSettings: (path) => deleteSettings(path),
    applyStatusLineSettings: (path, patch) => applyStatusLineSettings(path, patch),
    reloadPluginCommandSource: (registry) => {
      reloadPluginCommandSource(registry);
    },
    applyActiveModelChange: (cwd, modelId, options) => {
      applyActiveModelChange(cwd, modelId, options);
      return { applied: true };
    },
    getGitBranch: (cwd) => resolveGitBranch(cwd),
    getProviderDisplayName: (type) =>
      findProviderDefinition(providerDefinitions, type)?.displayName ?? type,
  };
}

function createTransportRegistry(): TransportRegistry {
  const registry = new TransportRegistry(getUserSettingsPath());
  registry.register(new WsTransport());
  return registry;
}
