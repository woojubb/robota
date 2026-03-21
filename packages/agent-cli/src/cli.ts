/**
 * CLI entry point — parses arguments, loads config/context, and starts the
 * Ink TUI or runs in print mode.
 *
 * CLI flags:
 *   robota                         Interactive TUI mode
 *   robota "prompt"                TUI with initial prompt (future)
 *   robota -p "prompt"             Print mode (one-shot, exit after response)
 *   robota -c                      Continue last session
 *   robota -r <id>                 Resume session by ID
 *   robota --model <model>         Model override
 *   robota --permission-mode <m>   plan|default|acceptEdits|bypassPermissions
 *   robota --max-turns <n>         Limit agentic turns
 *   robota --version               Print package version and exit
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  loadContext,
  detectProject,
  createSession,
  SessionStore,
  FileSessionLogger,
  projectPaths,
} from '@robota-sdk/agent-sdk';
import { promptForApproval } from '@robota-sdk/agent-sdk';
import { parseCliArgs } from './utils/cli-args.js';
import { getUserSettingsPath, deleteSettings } from './utils/settings-io.js';
import { PrintTerminal } from './print-terminal.js';
import { renderApp } from './ui/render.js';

/** Check if a settings file exists and contains valid JSON with provider info. */
function hasValidSettingsFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw.length === 0) return false;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Must have provider.apiKey to be considered valid
    const provider = parsed.provider as Record<string, unknown> | undefined;
    return !!provider?.apiKey;
  } catch {
    return false; // Corrupt JSON
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


/**
 * Check if any settings file exists. If not, prompt for API key and create one.
 */
async function ensureConfig(cwd: string): Promise<void> {
  const userPath = getUserSettingsPath();
  const projectPath = join(cwd, '.robota', 'settings.json');
  const localPath = join(cwd, '.robota', 'settings.local.json');

  if (hasValidSettingsFile(userPath) || hasValidSettingsFile(projectPath) || hasValidSettingsFile(localPath)) {
    return; // Config exists
  }

  // First run — prompt for API key
  process.stdout.write('\n');
  process.stdout.write('  Welcome to Robota CLI!\n');
  process.stdout.write('  No configuration found. Let\'s set up your API key.\n');
  process.stdout.write('\n');

  const apiKey = await new Promise<string>((resolve) => {
    process.stdout.write('  Anthropic API key: ');
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
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });

  if (!apiKey) {
    process.stderr.write('\n  No API key provided. Exiting.\n');
    process.exit(1);
  }

  // Create ~/.robota/settings.json
  const settingsDir = dirname(userPath);
  mkdirSync(settingsDir, { recursive: true });
  const settings = {
    provider: {
      name: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey,
    },
  };
  writeFileSync(userPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  process.stdout.write(`\n  Config saved to ${userPath}\n\n`);
}

/**
 * Delete user settings and exit. Used by --reset flag.
 */
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
 * Called from bin.ts as the top-level entry.
 */
export async function startCli(): Promise<void> {
  const args = parseCliArgs();

  // --version early exit
  if (args.version) {
    process.stdout.write(`robota ${readVersion()}\n`);
    return;
  }

  // --reset: delete config and exit
  if (args.reset) {
    resetConfig();
    return;
  }

  const cwd = process.cwd();

  // First-run setup: prompt for API key if no config exists
  await ensureConfig(cwd);

  // Load config and context in parallel
  const [config, context, projectInfo] = await Promise.all([
    loadConfig(cwd),
    loadContext(cwd),
    detectProject(cwd),
  ]);

  // Model override
  if (args.model !== undefined) {
    config.provider.model = args.model;
  }

  const sessionStore = new SessionStore();

  // Print mode: send single prompt, output response, exit
  if (args.printMode) {
    const prompt = args.positional.join(' ').trim();
    if (prompt.length === 0) {
      process.stderr.write('Print mode (-p) requires a prompt argument.\n');
      process.exit(1);
    }
    const terminal = new PrintTerminal();
    const paths = projectPaths(cwd);
    const session = createSession({
      config,
      context,
      terminal,
      sessionLogger: new FileSessionLogger(paths.logs),
      projectInfo,
      permissionMode: args.permissionMode,
      promptForApproval: promptForApproval,
    });
    const response = await session.run(prompt);
    process.stdout.write(response + '\n');
    return;
  }

  // Interactive TUI mode (Ink)
  renderApp({
    config,
    context,
    projectInfo,
    sessionStore,
    permissionMode: args.permissionMode,
    maxTurns: args.maxTurns,
    version: readVersion(),
  });
}
