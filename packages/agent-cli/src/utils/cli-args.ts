/**
 * CLI argument parsing and validation.
 * Pure functions — throw on invalid input, no process.* side effects.
 */

import { parseArgs } from 'node:util';

import type { TPermissionMode } from '@robota-sdk/agent-core';

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

const VALID_OUTPUT_FORMATS = ['text', 'json', 'stream-json'] as const;
export type TOutputFormat = (typeof VALID_OUTPUT_FORMATS)[number];

export interface IParsedCliArgs {
  positional: string[];
  help: boolean;
  printMode: boolean;
  continueMode: boolean;
  resumeId: string | undefined;
  language: string | undefined;
  permissionMode: TPermissionMode | undefined;
  maxTurns: number | undefined;
  forkSession: boolean;
  sessionName: string | undefined;
  outputFormat: TOutputFormat | undefined;
  format: string | undefined;
  summary: string | undefined;
  source: string | undefined;
  systemPrompt: string | undefined;
  appendSystemPrompt: string | undefined;
  taskFile: string | undefined;
  version: boolean;
  reset: boolean;
  bare: boolean;
  allowedTools: string | undefined;
  deniedTools: string | undefined;
  model: string | undefined;
  preset: string | undefined;
  noSessionPersistence: boolean;
  jsonSchema: string | undefined;
  configure: boolean;
  configureProvider: string | undefined;
  provider: string | undefined;
  providerType: string | undefined;
  baseURL: string | undefined;
  apiKey: string | undefined;
  apiKeyEnv: string | undefined;
  setCurrent: boolean;
  settingsScope: string | undefined;
  checkUpdate: boolean;
  disableUpdateCheck: boolean;
  dryRun: boolean;
  yes: boolean;
}

/** Return CLI usage help text. */
export function printHelp(): string {
  return `
Usage: robota [options] [-p <prompt>]

Options:
  -p <prompt>                Run in print (headless) mode with the given prompt
  --output-format <format>   Output format: text | json | stream-json (default: text)
  --system-prompt <text>     Override the system prompt for this session
  --append-system-prompt <t> Append text to the system prompt
  --language <lang>          Language preference (e.g. ko, en)
  --no-session-persistence   Disable session persistence for this run
  --permission-mode <mode>   Permission mode: plan | default | acceptEdits | bypassPermissions
  --max-turns <n>            Maximum agent turns before stopping
  -c, --continue             Continue the most recent session
  -r, --resume <id>          Resume a session by ID or name
  -n, --name <name>          Name for the new session
  --fork-session             Fork the current session into a new independent session
  --task-file <path>         Read a task prompt from file and append it to the system prompt
  --bare                     Print mode: output raw text only, no formatting wrapper
  --configure                Run interactive provider configuration
  --configure-provider <n>   Configure a specific provider
  --allowed-tools <list>     Comma-separated tool allowlist (TUI and print mode)
  --denied-tools <list>      Comma-separated tool denylist (TUI and print mode)
  --model <model>            Model override for this run
  --preset <id>              Preset id to apply (default: settings.preset or "default")
  --json-schema <schema>     Print mode: instruct the model to respond with JSON matching this schema
  --dry-run                  Alias for --permission-mode plan (plan only, no execution)
  --reset                    Delete ~/.robota/settings.json (provider profiles and preferences).
                             Asks for confirmation; use --yes to skip
  --yes                      Skip confirmation prompts (required for --reset in non-TTY)
  --check-update             Check for CLI updates
  --version                  Show version number
  -h, --help                 Show this help message

Commands:
  robota init                      Initialize AGENTS.md and .robota/settings.json
  robota diagnose                  Check setup and print a diagnostics report

Examples:
  robota                           Start interactive TUI session
  robota init                      Initialize project files
  robota -p "Hello"                Print mode: send prompt and exit
  robota -p "Hello" --output-format json
  robota -p "Review this diff" --bare    Raw output for shell pipelines
  robota --task-file task.md       Run task from file (appended to system prompt)
  robota -p "Refactor the auth module" --dry-run   Plan only, no execution
  robota --continue                Resume the last session
`;
}

/** Split a comma-separated tool list into trimmed, non-empty names. */
export function parseToolList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const tools = value
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return tools.length > 0 ? tools : undefined;
}

/** Validate and return a TOutputFormat from a raw CLI string, or throw on error. */
export function parseOutputFormat(raw: string | undefined): TOutputFormat | undefined {
  if (raw === undefined) return undefined;
  if (!(VALID_OUTPUT_FORMATS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid --output-format "${raw}". Valid: ${VALID_OUTPUT_FORMATS.join(' | ')}`);
  }
  return raw as TOutputFormat;
}

/** Validate and return a TPermissionMode from a raw CLI string, or throw on error. */
export function parsePermissionMode(raw: string | undefined): TPermissionMode | undefined {
  if (raw === undefined) return undefined;
  if (!VALID_MODES.includes(raw as TPermissionMode)) {
    throw new Error(`Invalid --permission-mode "${raw}". Valid: ${VALID_MODES.join(' | ')}`);
  }
  return raw as TPermissionMode;
}

/** Validate and return a positive integer from a raw CLI string, or throw on error. */
export function parseMaxTurns(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    throw new Error(`Invalid --max-turns "${raw}". Must be a positive integer.`);
  }
  return n;
}

const PARSE_ARGS_CONFIG = {
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    p: { type: 'boolean', short: 'p', default: false },
    continue: { type: 'boolean', short: 'c', default: false },
    resume: { type: 'string', short: 'r' },
    language: { type: 'string' },
    'permission-mode': { type: 'string' },
    'max-turns': { type: 'string' },
    'fork-session': { type: 'boolean', default: false },
    name: { type: 'string', short: 'n' },
    'output-format': { type: 'string' },
    format: { type: 'string' },
    summary: { type: 'string' },
    source: { type: 'string' },
    'system-prompt': { type: 'string' },
    'append-system-prompt': { type: 'string' },
    'task-file': { type: 'string' },
    version: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    bare: { type: 'boolean', default: false },
    'allowed-tools': { type: 'string' },
    'denied-tools': { type: 'string' },
    model: { type: 'string' },
    preset: { type: 'string' },
    'no-session-persistence': { type: 'boolean', default: false },
    'json-schema': { type: 'string' },
    configure: { type: 'boolean', default: false },
    'configure-provider': { type: 'string' },
    provider: { type: 'string' },
    type: { type: 'string' },
    'base-url': { type: 'string' },
    'api-key': { type: 'string' },
    'api-key-env': { type: 'string' },
    'set-current': { type: 'boolean', default: false },
    'settings-scope': { type: 'string' },
    'check-update': { type: 'boolean', default: false },
    'disable-update-check': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', short: 'y', default: false },
  },
} as const;

function mapParsedValues(
  values: ReturnType<typeof parseArgs<typeof PARSE_ARGS_CONFIG>>['values'],
  positionals: string[],
): IParsedCliArgs {
  return {
    positional: positionals,
    help: values['help'] ?? false,
    printMode: values['p'] ?? false,
    continueMode: values['continue'] ?? false,
    resumeId: values['resume'],
    language: values['language'],
    permissionMode: parsePermissionMode(values['permission-mode']),
    maxTurns: parseMaxTurns(values['max-turns']),
    forkSession: values['fork-session'] ?? false,
    sessionName: values['name'],
    outputFormat: parseOutputFormat(values['output-format']),
    format: values['format'],
    summary: values['summary'],
    source: values['source'],
    systemPrompt: values['system-prompt'],
    appendSystemPrompt: values['append-system-prompt'],
    taskFile: values['task-file'],
    version: values['version'] ?? false,
    reset: values['reset'] ?? false,
    bare: values['bare'] ?? false,
    allowedTools: values['allowed-tools'],
    deniedTools: values['denied-tools'],
    model: values['model'],
    preset: values['preset'],
    noSessionPersistence: values['no-session-persistence'] ?? false,
    jsonSchema: values['json-schema'],
    configure: values['configure'] ?? false,
    configureProvider: values['configure-provider'],
    provider: values['provider'],
    providerType: values['type'],
    baseURL: values['base-url'],
    apiKey: values['api-key'],
    apiKeyEnv: values['api-key-env'],
    setCurrent: values['set-current'] ?? false,
    settingsScope: values['settings-scope'],
    checkUpdate: values['check-update'] ?? false,
    disableUpdateCheck: values['disable-update-check'] ?? false,
    dryRun: values['dry-run'] ?? false,
    yes: values['yes'] ?? false,
  };
}

/** Parse and validate CLI arguments. */
export function parseCliArgs(): IParsedCliArgs {
  const { values, positionals } = parseArgs(PARSE_ARGS_CONFIG);
  const args = mapParsedValues(values, positionals);
  if (args.printMode) {
    if (args.resumeId === '') {
      throw new Error(
        'Print mode requires an explicit session id: -r <id|name> (the interactive session picker is TUI-only)',
      );
    }
    if (args.noSessionPersistence && (args.continueMode || args.resumeId !== undefined)) {
      throw new Error(
        '--no-session-persistence conflicts with -c/-r (resume needs the session store)',
      );
    }
  }
  if (args.dryRun) {
    if (args.permissionMode !== undefined && args.permissionMode !== 'plan') {
      throw new Error(
        `--dry-run is an alias for --permission-mode plan and conflicts with --permission-mode ${args.permissionMode}`,
      );
    }
    return { ...args, permissionMode: 'plan' };
  }
  return args;
}
