/**
 * CLI entry point — parses arguments, creates provider, and starts the Ink TUI.
 *
 * CLI composes provider definitions. SDK owns everything else
 * (config, context, session, tools).
 */

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import { createAgentCommandModule } from '@robota-sdk/agent-command-agent';
import { createBackgroundCommandModule } from '@robota-sdk/agent-command-background';
import { createProviderCommandModule } from '@robota-sdk/agent-command-provider';
import { createCompactCommandModule } from '@robota-sdk/agent-command-compact';
import { createContextCommandModule } from '@robota-sdk/agent-command-context';
import { createExitCommandModule } from '@robota-sdk/agent-command-exit';
import { createHelpCommandModule } from '@robota-sdk/agent-command-help';
import { createLanguageCommandModule } from '@robota-sdk/agent-command-language';
import { createMemoryCommandModule } from '@robota-sdk/agent-command-memory';
import { createModelCommandModule } from '@robota-sdk/agent-command-model';
import { createPermissionsCommandModule } from '@robota-sdk/agent-command-permissions';
import { createPluginCommandModule } from '@robota-sdk/agent-command-plugin';
import { createResetCommandModule } from '@robota-sdk/agent-command-reset';
import { createRewindCommandModule } from '@robota-sdk/agent-command-rewind';
import { createStatusLineCommandModule } from '@robota-sdk/agent-command-statusline';
import { createSessionCommandModule } from '@robota-sdk/agent-command-session';
import { createSkillsCommandModule } from '@robota-sdk/agent-command-skills';
import { createUserLocalCommandModule } from '@robota-sdk/agent-command-user-local';
import { createModeCommandModule } from '@robota-sdk/agent-command-mode';
import { createSettingsCommandModule } from '@robota-sdk/agent-command-settings';
import {
  InteractiveSession,
  createProjectSessionStore,
  projectPaths,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
} from '@robota-sdk/agent-sdk';
import type {
  ICommandHostAdapters,
  ICommandModule,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-sdk';
import { parseCliArgs } from './utils/cli-args.js';
import type { IParsedCliArgs } from './utils/cli-args.js';
import {
  getUserSettingsPath,
  deleteSettings,
  readSettings,
  writeSettings,
} from './utils/settings-io.js';
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
import { resolveProviderSettingsWriteTargetPath } from './utils/provider-configuration.js';
import { createHeadlessTransport } from '@robota-sdk/agent-transport-headless';
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import { TuiTransport } from '@robota-sdk/agent-transport-tui';
import type { ITuiCliAdapter } from '@robota-sdk/agent-transport-tui';
import { TransportRegistry } from './transports/transport-registry.js';
import { createManagedShellProcessRunner } from './background/managed-shell-process-runner.js';
import { createChildProcessSubagentRunnerFactory } from './subagents/index.js';
import {
  checkForCliUpdate,
  formatCliUpdateCheckMessage,
  formatCliUpdateNotice,
  getStartupCliUpdateNotice,
  shouldRunStartupCliUpdateCheck,
} from './utils/update-check.js';
import type { ICliUpdateNotice } from './utils/update-check.js';
import { applyStatusLineSettings } from './utils/statusline-settings.js';
import { applyActiveModelChange } from './utils/provider-configuration.js';
import { resolveGitBranch } from './utils/git-branch.js';
import { reloadPluginCommandSource } from './plugins/plugin-command-source-loader.js';
import { createCliPluginCommandAdapter } from './plugins/plugin-command-adapter.js';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';

const PRINTABLE_ASCII_START = 32;

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

/** Prompt for input in raw mode. Mask with asterisks if masked=true. */
function promptInput(label: string, masked = false): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    process.stdout.write(label);
    let input = '';
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (!stdin.isTTY) {
      reject(
        new Error(
          'Cannot prompt for input: stdin is not a TTY.\n' +
            'Set your API key via environment variable instead:\n' +
            '  ANTHROPIC_API_KEY=<key> robota\n' +
            '  OPENAI_API_KEY=<key> robota',
        ),
      );
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (data: string): void => {
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(input.trim());
          return;
        } else if (ch === '\x7f' || ch === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch === '\x03') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          process.stdout.write('\n');
          process.exit(0);
        } else if (ch.charCodeAt(0) >= PRINTABLE_ASCII_START) {
          input += ch;
          process.stdout.write(masked ? '*' : ch);
        }
      }
    };
    stdin.on('data', onData);
  });
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
  backgroundTaskRunners: ReturnType<typeof createManagedShellProcessRunner>[],
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
  });

  const transport = createHeadlessTransport({
    outputFormat: (args.outputFormat as 'text' | 'json' | 'stream-json') ?? 'text',
    prompt,
  });
  session.attachTransport(transport);
  await transport.start();
  await session.shutdown({ reason: 'prompt_input_exit', message: 'Headless transport complete' });
  process.exit(transport.getExitCode());
}

export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  const args = parseCliArgs();
  const version = readVersion();

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

  if (await runUserLocalDirectCommandIfRequested(args, cwd)) {
    return;
  }

  const { commandHostAdapters, providerDefinitions, commandModules, startupUpdateNoticePromise } =
    buildCommandSetup(cwd, args, options, version);

  if (args.configure) {
    await runInteractiveProviderSetup(cwd, args, promptInput, providerDefinitions);
    return;
  }

  if (handleProviderConfigurationArgs(cwd, args, providerDefinitions)) {
    return;
  }

  try {
    await ensureConfig(cwd, args, promptInput, providerDefinitions);
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
  const backgroundTaskRunners = [createManagedShellProcessRunner()];
  const paths = projectPaths(cwd);
  const subagentRunnerFactory = createChildProcessSubagentRunnerFactory({
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
    providerProfileName,
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
    startupUpdateNotice: startupUpdateNoticePromise
      ? startupUpdateNoticePromise.then((n) => (n ? formatCliUpdateNotice(n) : undefined))
      : undefined,
    transportRegistry: createTransportRegistry(),
    cliAdapter: createTuiCliAdapter(),
    reloadPluginCommandSource,
  });
  await tuiTransport.start();
  process.exit(0);
}

function createTuiCliAdapter(): ITuiCliAdapter {
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
  };
}

function createTransportRegistry(): TransportRegistry {
  const registry = new TransportRegistry(getUserSettingsPath());
  registry.register(new WsTransport());
  return registry;
}
