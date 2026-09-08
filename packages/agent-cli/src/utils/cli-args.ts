/**
 * CLI argument parsing and validation.
 * Pure functions — throw on invalid input, no process.* side effects.
 */

import { parseArgs } from 'node:util';

import { OUTPUT_FORMATS, type TOutputFormat } from '@robota-sdk/agent-framework';

import type { TPermissionMode } from '@robota-sdk/agent-core';

// Issue #2052: the output-format vocabulary is owned by the headless transport; re-exported here so
// existing CLI imports keep working without a second declaration of the same union.
export type { TOutputFormat };

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

const VALID_OUTPUT_FORMATS = OUTPUT_FORMATS;

export interface IParsedCliArgs {
  positional: string[];
  help: boolean;
  printMode: boolean;
  /** RUNTIME-001: run the headless runtime host (serve the WS, no ink) — the backend apps/agent-app spawns. */
  serve: boolean;
  /** GUI-007: with `--serve --open`, also serve the CLI's web monitor SPA over localhost and open it. */
  open: boolean;
  continueMode: boolean;
  resumeId: string | undefined;
  language: string | undefined;
  permissionMode: TPermissionMode | undefined;
  maxTurns: number | undefined;
  /** GOAL-001: autonomous objective to pursue headlessly (--goal). */
  goal: string | undefined;
  /** GOAL-001: per-goal turn budget (--goal-max-iterations). */
  goalMaxIterations: number | undefined;
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
  /** INFRA-018: replay a recorded session log instead of calling a model (offline/deterministic). */
  sessionLog: string | undefined;
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
  /**
   * SELFHOST-008 P6: tri-state memory enablement override — `true` (`--memory`), `false`
   * (`--no-memory`), or `undefined` (neither given, defer to settings/env). `--no-memory` wins if both.
   */
  memory: boolean | undefined;
  /** SELFHOST-008 P6: `--memory-autosave` flips the capture policy to `auto_save`. */
  memoryAutoSave: boolean;
  /**
   * CLI-2004: tri-state screen-reader override — `true` (`--screen-reader`), `false`
   * (`--no-screen-reader`), or `undefined` (neither given, defer to env/settings). `--no-screen-reader`
   * wins if both. Unlike memory, the FLAG is the top tier: see `startup/screen-reader-enablement.ts`.
   */
  screenReader: boolean | undefined;
}

// CLI-2004: the help catalogue is its own module; re-exported so every import site is unchanged.
export { printHelp } from './cli-help.js';

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
    goal: { type: 'string' },
    'goal-max-iterations': { type: 'string' },
    'fork-session': { type: 'boolean', default: false },
    serve: { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
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
    'session-log': { type: 'string' },
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
    // SELFHOST-008 P6: no `default` so absence is distinguishable (tri-state override).
    memory: { type: 'boolean' },
    'no-memory': { type: 'boolean' },
    'memory-autosave': { type: 'boolean' },
    // CLI-2004: same tri-state shape — absence must stay distinguishable from an explicit `false`.
    'screen-reader': { type: 'boolean' },
    'no-screen-reader': { type: 'boolean' },
  },
} as const;

type TParsedArgValues = ReturnType<typeof parseArgs<typeof PARSE_ARGS_CONFIG>>['values'];

/**
 * SELFHOST-008 P6: resolve the memory flags separately so mapParsedValues stays within its size budget.
 * `--memory`/`--no-memory` is tri-state (`--no-memory` wins if both); `--memory-autosave` is a plain flag.
 */
function resolveMemoryArgs(
  values: TParsedArgValues,
): Pick<IParsedCliArgs, 'memory' | 'memoryAutoSave'> {
  const memory =
    values['no-memory'] === true ? false : values['memory'] === true ? true : undefined;
  return { memory, memoryAutoSave: values['memory-autosave'] ?? false };
}

/**
 * CLI-2004: `--screen-reader` / `--no-screen-reader` is the same tri-state shape as the memory pair —
 * `--no-screen-reader` wins if both are given, and absence stays `undefined` so the enablement
 * resolver can tell "no opinion" from "explicitly off".
 */
function resolveScreenReaderArgs(values: TParsedArgValues): Pick<IParsedCliArgs, 'screenReader'> {
  const screenReader =
    values['no-screen-reader'] === true
      ? false
      : values['screen-reader'] === true
        ? true
        : undefined;
  return { screenReader };
}

function mapParsedValues(
  values: TParsedArgValues,
  positionals: string[],
): Omit<IParsedCliArgs, 'memory' | 'memoryAutoSave' | 'screenReader'> {
  return {
    positional: positionals,
    help: values['help'] ?? false,
    printMode: values['p'] ?? false,
    serve: values['serve'] ?? false,
    open: values['open'] ?? false,
    continueMode: values['continue'] ?? false,
    resumeId: values['resume'],
    language: values['language'],
    permissionMode: parsePermissionMode(values['permission-mode']),
    maxTurns: parseMaxTurns(values['max-turns']),
    goal: values['goal'],
    goalMaxIterations: parseMaxTurns(values['goal-max-iterations']),
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
    sessionLog: values['session-log'],
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

export function parseCliArgs(): IParsedCliArgs {
  const { values, positionals } = parseArgs(PARSE_ARGS_CONFIG);
  const args: IParsedCliArgs = {
    ...mapParsedValues(values, positionals),
    ...resolveMemoryArgs(values),
    ...resolveScreenReaderArgs(values),
  };
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
