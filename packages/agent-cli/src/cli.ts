/**
 * CLI entry point — parses arguments, loads config/context, creates a Session,
 * and starts the REPL or runs in print mode.
 *
 * CLI flags:
 *   robota                         REPL mode
 *   robota "prompt"                REPL with initial prompt
 *   robota -p "prompt"             Print mode (one-shot, exit after response)
 *   robota -c                      Continue last session
 *   robota -r <id>                 Resume session by ID
 *   robota --model <model>         Model override
 *   robota --permission-mode <m>   plan|default|acceptEdits|bypassPermissions
 *   robota --max-turns <n>         Limit agentic turns
 *   robota --version               Print package version and exit
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/config-loader.js';
import { loadContext } from './context/context-loader.js';
import { detectProject } from './context/project-detector.js';
import { Session } from './session.js';
import { SessionStore } from './session-store.js';
import { ReplRenderer } from './repl/repl-renderer.js';
import { startRepl } from './repl/repl-session.js';
import type { TPermissionMode } from './types.js';
import type { ISessionOptions } from './session.js';

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

/** Read version from package.json at runtime.
 *
 * The compiled bin.js lives at dist/node/bin.js, two directories below package.json.
 * The source bin.ts lives at src/bin.ts, one directory below package.json.
 * We try both relative paths so this works in both compiled and dev (tsx) modes.
 */
function readVersion(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const dir = dirname(thisFile);

    // Try: dist/node → ../../package.json (compiled)
    // Try: src      → ../package.json    (tsx dev mode)
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

/** Parse and validate CLI arguments */
function parseCliArgs(): {
  positional: string[];
  printMode: boolean;
  continueMode: boolean;
  resumeId: string | undefined;
  model: string | undefined;
  permissionMode: TPermissionMode | undefined;
  maxTurns: number | undefined;
  version: boolean;
} {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      p: { type: 'boolean', short: 'p', default: false },
      c: { type: 'boolean', short: 'c', default: false },
      r: { type: 'string', short: 'r' },
      model: { type: 'string' },
      'permission-mode': { type: 'string' },
      'max-turns': { type: 'string' },
      version: { type: 'boolean', default: false },
    },
  });

  let permissionMode: TPermissionMode | undefined;
  const rawMode = values['permission-mode'];
  if (rawMode !== undefined) {
    if (!VALID_MODES.includes(rawMode as TPermissionMode)) {
      process.stderr.write(
        `Invalid --permission-mode "${rawMode}". Valid: ${VALID_MODES.join(' | ')}\n`,
      );
      process.exit(1);
    }
    permissionMode = rawMode as TPermissionMode;
  }

  let maxTurns: number | undefined;
  const rawTurns = values['max-turns'];
  if (rawTurns !== undefined) {
    maxTurns = parseInt(rawTurns, 10);
    if (isNaN(maxTurns) || maxTurns <= 0) {
      process.stderr.write(`Invalid --max-turns "${rawTurns}". Must be a positive integer.\n`);
      process.exit(1);
    }
  }

  return {
    positional: positionals,
    printMode: values['p'] ?? false,
    continueMode: values['c'] ?? false,
    resumeId: values['r'],
    model: values['model'],
    permissionMode,
    maxTurns,
    version: values['version'] ?? false,
  };
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

  const cwd = process.cwd();
  const terminal = new ReplRenderer();

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

  // Build session options
  const sessionOptions: ISessionOptions = {
    config,
    context,
    terminal,
    projectInfo,
    sessionStore,
    permissionMode: args.permissionMode,
    maxTurns: args.maxTurns,
  };

  // Resume session by ID
  if (args.resumeId !== undefined) {
    const record = sessionStore.load(args.resumeId);
    if (!record) {
      terminal.writeError(`Session "${args.resumeId}" not found.`);
      process.exit(1);
    }
    // Log resume notice; the actual history restoration is not yet implemented
    terminal.writeLine(`Resuming session: ${args.resumeId}`);
  }

  // Continue last session (shorthand for -r with latest session id)
  if (args.continueMode) {
    const sessions = sessionStore.list();
    const last = sessions[0];
    if (!last) {
      terminal.writeLine('No previous session to continue. Starting a new session.');
    } else {
      terminal.writeLine(`Continuing session: ${last.id}`);
    }
  }

  const session = new Session(sessionOptions);

  // Print mode: send single prompt, output response, exit
  if (args.printMode) {
    const prompt = args.positional.join(' ').trim();
    if (prompt.length === 0) {
      terminal.writeError('Print mode (-p) requires a prompt argument.');
      process.exit(1);
    }
    const response = await session.run(prompt);
    process.stdout.write(response + '\n');
    return;
  }

  // REPL mode
  const initialPrompt = args.positional.join(' ').trim() || undefined;

  await startRepl(session, terminal, sessionStore, projectInfo.name);

  // If there was an initial prompt passed as positional, send it after the REPL
  // starts (not implemented here — it would require piping it as first line input).
  // For the MVP we simply ignore it in REPL mode if no -p flag is set.
  void initialPrompt;
}
