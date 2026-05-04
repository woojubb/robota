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
import { createModeCommandModule } from '@robota-sdk/agent-command-mode';
import { createModelCommandModule } from '@robota-sdk/agent-command-model';
import { createPermissionsCommandModule } from '@robota-sdk/agent-command-permissions';
import { createPluginCommandModule } from '@robota-sdk/agent-command-plugin';
import { createResetCommandModule } from '@robota-sdk/agent-command-reset';
import { createRewindCommandModule } from '@robota-sdk/agent-command-rewind';
import { createStatusLineCommandModule } from '@robota-sdk/agent-command-statusline';
import { createSessionCommandModule } from '@robota-sdk/agent-command-session';
import { InteractiveSession, projectPaths } from '@robota-sdk/agent-sdk';
import type {
  ICommandHostAdapters,
  ICommandModule,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-sdk';
import { SessionStore } from '@robota-sdk/agent-sessions';
import { parseCliArgs } from './utils/cli-args.js';
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
import { renderApp } from './ui/render.js';
import { createManagedShellProcessRunner } from './background/managed-shell-process-runner.js';
import { createChildProcessSubagentRunnerFactory } from './subagents/index.js';
import {
  checkForCliUpdate,
  formatCliUpdateCheckMessage,
  getStartupCliUpdateNotice,
  shouldRunStartupCliUpdateCheck,
} from './utils/update-check.js';
import { createCliPluginCommandAdapter } from './plugins/plugin-command-adapter.js';

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
  return new Promise<string>((resolve) => {
    process.stdout.write(label);
    let input = '';
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
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
          process.stdout.write('\n');
          process.exit(0);
        } else if (ch.charCodeAt(0) >= 32) {
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
  const commandHostAdapters: ICommandHostAdapters = {
    settings: {
      read: () => readSettings(getUserSettingsPath()),
      write: (settings) => writeSettings(getUserSettingsPath(), settings),
    },
    plugin: createCliPluginCommandAdapter(cwd),
  };
  const providerDefinitions = options.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS;
  const commandModules: readonly ICommandModule[] = [
    createHelpCommandModule(),
    createAgentCommandModule(),
    createModelCommandModule({
      providerDefinitions,
      settings: {
        readMergedSettings: () => readMergedProviderSettings(cwd),
      },
    }),
    createModeCommandModule(),
    createPermissionsCommandModule(),
    createLanguageCommandModule(),
    createBackgroundCommandModule(),
    createMemoryCommandModule(),
    createCompactCommandModule(),
    createContextCommandModule(),
    createExitCommandModule(),
    createSessionCommandModule(),
    createResetCommandModule(),
    createRewindCommandModule(),
    createStatusLineCommandModule(),
    createPluginCommandModule(),
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
    ...(options.commandModules ?? []),
  ];
  const startupUpdateNoticePromise = shouldRunStartupCliUpdateCheck(args)
    ? getStartupCliUpdateNotice({ currentVersion: version })
    : undefined;

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
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  // CLI resolves the active provider profile through injected provider definitions.
  const providerOptions = args.provider
    ? { providerOverride: args.provider, providerDefinitions }
    : { providerDefinitions };
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
  const sessionStore = new SessionStore(paths.sessions);
  let resumeSessionId: string | undefined;

  if (args.continueMode) {
    const sessions = sessionStore.list().filter((s) => s.cwd === cwd);
    if (sessions.length > 0) {
      resumeSessionId = sessions[0]!.id;
    }
  } else if (args.resumeId !== undefined) {
    if (args.resumeId === '') {
      // -r without argument = show picker (handled in App.tsx)
      resumeSessionId = '__picker__';
    } else {
      const sessions = sessionStore.list();
      const match = sessions.find((s) => s.id === args.resumeId || s.name === args.resumeId);
      if (match) {
        resumeSessionId = match.id;
      } else {
        process.stderr.write(`Session not found: ${args.resumeId}\n`);
        process.exit(1);
      }
    }
  }

  // Print mode (-p): one-shot prompt via headless transport, then exit
  if (args.printMode) {
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

    // Build appendSystemPrompt from --append-system-prompt and --json-schema
    const appendParts: string[] = [];
    if (args.appendSystemPrompt) appendParts.push(args.appendSystemPrompt);
    if (args.taskFile) {
      try {
        appendParts.push(readTaskFilePrompt(cwd, args.taskFile));
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
    }
    if (args.jsonSchema)
      appendParts.push(
        `Respond with valid JSON only, matching this JSON schema:\n${args.jsonSchema}`,
      );
    const appendSystemPrompt = appendParts.length > 0 ? appendParts.join('\n\n') : undefined;

    // TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field

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

  // Interactive TUI mode (Ink)
  renderApp({
    cwd,
    provider,
    providerOverride: args.provider,
    modelId,
    language: args.language,
    permissionMode: args.permissionMode,
    maxTurns: args.maxTurns,
    version,
    sessionStore,
    resumeSessionId,
    forkSession: args.forkSession,
    sessionName: args.sessionName,
    backgroundTaskRunners,
    subagentRunnerFactory,
    commandModules,
    commandHostAdapters,
    startupUpdateNoticePromise,
  });
}
