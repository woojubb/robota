/**
 * CLI entry point — parses arguments, creates provider, and starts the Ink TUI.
 *
 * CLI owns provider creation. SDK owns everything else
 * (config, context, session, tools).
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { SessionStore } from '@robota-sdk/agent-sessions';
import { parseCliArgs } from './utils/cli-args.js';
import { getUserSettingsPath, deleteSettings } from './utils/settings-io.js';
import { createProviderFromSettings, readProviderSettings } from './utils/provider-factory.js';
import { renderApp } from './ui/render.js';

/** Result of checking a settings file. */
type TSettingsCheck = 'missing' | 'valid' | 'corrupt' | 'incomplete';

/** Check a settings file's state. */
function checkSettingsFile(filePath: string): TSettingsCheck {
  if (!existsSync(filePath)) return 'missing';
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw.length === 0) return 'incomplete';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const provider = parsed.provider as Record<string, unknown> | undefined;
    if (!provider?.apiKey) return 'incomplete';
    return 'valid';
  } catch {
    return 'corrupt';
  }
}

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

/**
 * Check if any settings file exists. If not, prompt for setup and create one.
 */
async function ensureConfig(cwd: string): Promise<void> {
  const userPath = getUserSettingsPath();
  const projectPath = join(cwd, '.robota', 'settings.json');
  const localPath = join(cwd, '.robota', 'settings.local.json');

  const paths = [userPath, projectPath, localPath];
  const checks = paths.map((p) => ({ path: p, status: checkSettingsFile(p) }));

  if (checks.some((c) => c.status === 'valid')) {
    return;
  }

  const corrupt = checks.filter((c) => c.status === 'corrupt');
  const incomplete = checks.filter((c) => c.status === 'incomplete');

  process.stdout.write('\n');
  if (corrupt.length > 0) {
    for (const c of corrupt) {
      process.stderr.write(`  ERROR: Settings file is corrupt (invalid JSON): ${c.path}\n`);
    }
    process.stdout.write('\n');
  }
  if (incomplete.length > 0) {
    for (const c of incomplete) {
      process.stderr.write(`  WARNING: Settings file is missing provider.apiKey: ${c.path}\n`);
    }
    process.stdout.write('\n');
  }

  if (corrupt.length === 0 && incomplete.length === 0) {
    process.stdout.write('  Welcome to Robota CLI!\n');
    process.stdout.write("  No configuration found. Let's set up.\n");
  } else {
    process.stdout.write('  Reconfiguring...\n');
  }
  process.stdout.write('\n');

  const apiKey = await promptInput('  Anthropic API key: ', true);
  if (!apiKey) {
    process.stderr.write('\n  No API key provided. Exiting.\n');
    process.exit(1);
  }

  const language = await promptInput('  Response language (ko/en/ja/zh, default: en): ');

  const settingsDir = dirname(userPath);
  mkdirSync(settingsDir, { recursive: true });
  const settings: Record<string, unknown> = {
    provider: {
      name: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey,
    },
  };
  if (language) {
    settings.language = language;
  }
  writeFileSync(userPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  process.stdout.write(`\n  Config saved to ${userPath}\n\n`);
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
export async function startCli(): Promise<void> {
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

  // First-run setup: prompt for API key if no config exists
  await ensureConfig(cwd);

  // CLI owns provider creation
  const providerSettings = readProviderSettings(cwd);
  const modelId = args.model ?? providerSettings.model;
  const provider: IAIProvider = createProviderFromSettings(cwd, args.model);

  // Session management
  const sessionStore = new SessionStore();
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

  // Print mode (-p): one-shot prompt, output response, exit
  if (args.printMode) {
    const prompt = args.positional.join(' ').trim();
    if (prompt.length === 0) {
      process.stderr.write('Print mode (-p) requires a prompt argument.\n');
      process.exit(1);
    }

    const session = new InteractiveSession({
      cwd,
      provider,
      permissionMode: args.permissionMode ?? 'bypassPermissions',
      maxTurns: args.maxTurns,
      sessionStore,
      sessionName: args.sessionName,
    });

    await new Promise<void>((resolve, reject) => {
      session.on('complete', (result) => {
        process.stdout.write(result.response + '\n');
        resolve();
      });
      session.on('interrupted', (result) => {
        if (result.response) process.stdout.write(result.response + '\n');
        resolve();
      });
      session.on('error', (err) => reject(err));
      session.submit(prompt).catch(reject);
    });
    return;
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
  });
}
