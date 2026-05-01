/**
 * CLI entry point — parses arguments, creates provider, and starts the Ink TUI.
 *
 * CLI owns provider creation. SDK owns everything else
 * (config, context, session, tools).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { InteractiveSession, projectPaths } from '@robota-sdk/agent-sdk';
import type { ICommandModule } from '@robota-sdk/agent-sdk';
import { SessionStore } from '@robota-sdk/agent-sessions';
import { parseCliArgs } from './utils/cli-args.js';
import { getUserSettingsPath, deleteSettings } from './utils/settings-io.js';
import { createProviderFromSettings, readProviderSettings } from './utils/provider-factory.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './utils/provider-setup.js';
import { createHeadlessTransport } from '@robota-sdk/agent-transport-headless';
import { renderApp } from './ui/render.js';
import { createManagedShellProcessRunner } from './background/managed-shell-process-runner.js';
import { createChildProcessSubagentRunnerFactory } from './subagents/index.js';

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
}

export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  const args = parseCliArgs();

  if (args.version) {
    process.stdout.write(`robota ${readVersion()}\n`);
    return;
  }

  if (args.reset) {
    resetConfig();
    return;
  }

  const cwd = process.cwd();

  if (args.configure) {
    await runInteractiveProviderSetup(cwd, args, promptInput);
    return;
  }

  if (handleProviderConfigurationArgs(cwd, args)) {
    return;
  }

  try {
    await ensureConfig(cwd, args, promptInput);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  // CLI owns provider creation
  const providerOptions = args.provider ? { providerOverride: args.provider } : {};
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
      commandModules: options.commandModules,
    });

    const transport = createHeadlessTransport({
      outputFormat: (args.outputFormat as 'text' | 'json' | 'stream-json') ?? 'text',
      prompt,
    });
    session.attachTransport(transport);
    await transport.start();
    process.exit(transport.getExitCode());
  }

  // Interactive TUI mode (Ink)
  renderApp({
    cwd,
    provider,
    modelId,
    language: args.language,
    permissionMode: args.permissionMode,
    maxTurns: args.maxTurns,
    version: readVersion(),
    sessionStore,
    resumeSessionId,
    forkSession: args.forkSession,
    sessionName: args.sessionName,
    backgroundTaskRunners,
    subagentRunnerFactory,
    commandModules: options.commandModules,
  });
}
