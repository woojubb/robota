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

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';
import {
  loadConfig,
  loadContext,
  detectProject,
  Session,
  SessionStore,
  FileSessionLogger,
  buildSystemPrompt,
} from '@robota-sdk/agent-sdk';
import type { TPermissionMode } from '@robota-sdk/agent-sdk';
import type { ITerminalOutput, ISpinner } from './types.js';
import { promptForApproval } from './permissions/permission-prompt.js';
import { renderApp } from './ui/render.js';

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

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

/** Validate and return a TPermissionMode from a raw CLI string, or exit on error. */
function parsePermissionMode(raw: string | undefined): TPermissionMode | undefined {
  if (raw === undefined) return undefined;
  if (!VALID_MODES.includes(raw as TPermissionMode)) {
    process.stderr.write(`Invalid --permission-mode "${raw}". Valid: ${VALID_MODES.join(' | ')}\n`);
    process.exit(1);
  }
  return raw as TPermissionMode;
}

/** Validate and return a positive integer from a raw CLI string, or exit on error. */
function parseMaxTurns(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    process.stderr.write(`Invalid --max-turns "${raw}". Must be a positive integer.\n`);
    process.exit(1);
  }
  return n;
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

  return {
    positional: positionals,
    printMode: values['p'] ?? false,
    continueMode: values['c'] ?? false,
    resumeId: values['r'],
    model: values['model'],
    permissionMode: parsePermissionMode(values['permission-mode']),
    maxTurns: parseMaxTurns(values['max-turns']),
    version: values['version'] ?? false,
  };
}

/**
 * Minimal ITerminalOutput for print mode (-p).
 *
 * Writes to stdout/stderr directly. The readline-based prompt and select are
 * only invoked if the agent triggers a permission-gated tool, which is rare in
 * one-shot print mode but must still work correctly.
 */
class PrintTerminal implements ITerminalOutput {
  write(text: string): void {
    process.stdout.write(text);
  }
  writeLine(text: string): void {
    process.stdout.write(text + '\n');
  }
  writeMarkdown(md: string): void {
    // Print mode outputs plain text — no markdown rendering needed
    process.stdout.write(md);
  }
  writeError(text: string): void {
    process.stderr.write(text + '\n');
  }
  prompt(question: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
        historySize: 0,
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
  async select(options: string[], initialIndex = 0): Promise<number> {
    for (let i = 0; i < options.length; i++) {
      const marker = i === initialIndex ? '>' : ' ';
      process.stdout.write(`  ${marker} ${i + 1}) ${options[i]}\n`);
    }
    const answer = await this.prompt(
      `  Choose [1-${options.length}] (default: ${options[initialIndex]}): `,
    );
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === '') return initialIndex;
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) return num - 1;
    return initialIndex;
  }
  spinner(_message: string): ISpinner {
    return { stop(): void {}, update(): void {} };
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

  const cwd = process.cwd();

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
    const logDir = join(cwd, '.robota', 'logs');
    const session = new Session({
      config,
      context,
      terminal,
      sessionLogger: new FileSessionLogger(logDir),
      projectInfo: projectInfo as { type: string; language: string },
      permissionMode: args.permissionMode,
      systemPromptBuilder: buildSystemPrompt as (params: {
        agentsMd: string;
        claudeMd: string;
        toolDescriptions: string[];
        trustLevel: 'safe' | 'moderate' | 'full';
        projectInfo: { type: string; language: string };
      }) => string,
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
