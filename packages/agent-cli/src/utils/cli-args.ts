/**
 * CLI argument parsing and validation.
 * Pure functions — throw on invalid input, no process.* side effects.
 */

import { parseArgs } from 'node:util';

import {
  OUTPUT_FORMATS,
  parseFallbackModelList,
  parseModelEffort,
  type TOutputFormat,
  type TEffortSelection,
} from '@robota-sdk/agent-framework';

import type { TPermissionMode } from '@robota-sdk/agent-core';

// Issue #2052: the output-format vocabulary is owned by the headless transport; re-exported here so
// existing CLI imports keep working without a second declaration of the same union.
export type { TOutputFormat };

const VALID_MODES: TPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions',
  'auto',
];

const VALID_OUTPUT_FORMATS = OUTPUT_FORMATS;

export interface IParsedCliArgs {
  positional: string[];
  help: boolean;
  printMode: boolean;
  /** RUNTIME-001: run the headless runtime host (serve the WS, no ink) — the backend apps/agent-app spawns. */
  serve: boolean;
  /** Internal opt-in identity for one detached, supervisor-owned runtime. */
  supervisedSessionId?: string;
  /** Supervised child only: read the external-event grants its launcher handed over. */
  supervisedExternalEventGrants?: boolean;
  /** TUI only: files, each one external-event grant verified by access token. */
  externalEventGrantFiles?: string[];
  /** The loopback port the external-event endpoint listens on, behind the owner's proxy. */
  externalEventPort?: number;
  /** Proxy addresses whose `X-Forwarded-For` the external-event endpoint believes. */
  externalEventTrustedProxies?: string[];
  /** MCP-2533: selecting HTTP also requires an exclusive owner-only token file. */
  mcpHttpTokenFile?: string;
  mcpHttpPort?: number;
  /** `robota mcp serve` remote resource-server settings; a non-loopback bind requires them. */
  mcpHttpHost?: string;
  mcpHttpPublicUrl?: string;
  mcpOauthIssuer?: string;
  mcpOauthScopes?: string[];
  mcpOauthAllowedSubjects?: string[];
  mcpTrustedProxies?: string[];
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
  /** Issue #3081: this run is the target of a `/cd` from this directory (internal flag). */
  movedFrom?: string;
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
  /** Start with every customization off: instructions, skills, commands, agents, plugins, hooks, MCP. */
  safeMode: boolean;
  allowedTools: string | undefined;
  deniedTools: string | undefined;
  model: string | undefined;
  /** Models to move a turn to when the primary is overloaded; replaces the settings' chain. */
  fallbackModel?: string[];
  /** Requested model-effort level; `auto` follows the selected model default. */
  effort?: TEffortSelection;
  /** The advisor for this run (`<profile>`, `<profile>:<model>` or `off`); wins over the saved one. */
  advisor?: string;
  preset: string | undefined;
  /** CLI-1988: provider-neutral output-style id; resolved against the startup style registry. */
  outputStyle?: string;
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
  /**
   * SCREEN-2002: tri-state reduced-motion override — `true` (`--reduced-motion`), `false`
   * (`--no-reduced-motion`), or `undefined` (neither given, defer to env/settings).
   * `--no-reduced-motion` wins if both. The FLAG is the top tier, like the screen-reader pair.
   */
  reducedMotion: boolean | undefined;
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
    // Issue #3081: set only by `/cd` when it starts the session in the target directory; not in help.
    'moved-from': { type: 'string' },
    'restricted-workspace': { type: 'boolean', default: false },
    'safe-mode': { type: 'boolean', default: false },
    serve: { type: 'boolean', default: false },
    'supervised-session-id': { type: 'string' },
    'supervised-external-event-grants': { type: 'boolean' },
    'external-event-grant': { type: 'string', multiple: true },
    'external-event-port': { type: 'string' },
    'external-event-trusted-proxy': { type: 'string', multiple: true },
    'http-token-file': { type: 'string' },
    'http-port': { type: 'string' },
    'http-host': { type: 'string' },
    'http-public-url': { type: 'string' },
    'oauth-issuer': { type: 'string' },
    'oauth-scopes': { type: 'string' },
    'oauth-allowed-subjects': { type: 'string' },
    'trusted-proxy': { type: 'string', multiple: true },
    // Retired: parsed only so it is refused with a reason instead of as an unknown flag.
    'external-event-allow': { type: 'string', multiple: true },
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
    'fallback-model': { type: 'string' },
    effort: { type: 'string' },
    advisor: { type: 'string' },
    preset: { type: 'string' },
    'output-style': { type: 'string' },
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
    // SCREEN-2002: the same tri-state shape again. `--no-reduced-motion` exists so a run can
    // override a PERSISTED `reducedMotion: true` for once, which a bare `--reduced-motion` cannot.
    'reduced-motion': { type: 'boolean' },
    'no-reduced-motion': { type: 'boolean' },
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

/**
 * SCREEN-2002: `--reduced-motion` / `--no-reduced-motion`, tri-state like the pair above —
 * `--no-reduced-motion` wins if both are given, and absence stays `undefined` so the resolver can
 * tell "no opinion" from "explicitly animate".
 */
function resolveReducedMotionArgs(values: TParsedArgValues): Pick<IParsedCliArgs, 'reducedMotion'> {
  const reducedMotion =
    values['no-reduced-motion'] === true
      ? false
      : values['reduced-motion'] === true
        ? true
        : undefined;
  return { reducedMotion };
}

function parseEventPort(raw: string): number {
  const port = Number(raw);
  if (!/^[0-9]+$/u.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--external-event-port must be an integer in 1..65535');
  }
  return port;
}

function mapParsedValues(
  values: TParsedArgValues,
  positionals: string[],
): Omit<IParsedCliArgs, 'memory' | 'memoryAutoSave' | 'screenReader' | 'reducedMotion'> {
  return {
    positional: positionals,
    help: values['help'] ?? false,
    printMode: values['p'] ?? false,
    serve: values['serve'] ?? false,
    supervisedSessionId: values['supervised-session-id'],
    ...(values['supervised-external-event-grants'] === true
      ? { supervisedExternalEventGrants: true }
      : {}),
    externalEventGrantFiles: values['external-event-grant'] ?? [],
    ...(values['external-event-port'] !== undefined
      ? { externalEventPort: parseEventPort(values['external-event-port']) }
      : {}),
    ...(values['external-event-trusted-proxy'] !== undefined
      ? { externalEventTrustedProxies: values['external-event-trusted-proxy'] }
      : {}),
    mcpHttpTokenFile: values['http-token-file'],
    mcpHttpPort: values['http-port'] === undefined ? undefined : Number(values['http-port']),
    mcpHttpHost: values['http-host'],
    mcpHttpPublicUrl: values['http-public-url'],
    mcpOauthIssuer: values['oauth-issuer'],
    mcpOauthScopes: parseToolList(values['oauth-scopes']),
    mcpOauthAllowedSubjects: parseToolList(values['oauth-allowed-subjects']),
    mcpTrustedProxies: values['trusted-proxy'],
    open: values['open'] ?? false,
    continueMode: values['continue'] ?? false,
    resumeId: values['resume'],
    language: values['language'],
    permissionMode: parsePermissionMode(values['permission-mode']),
    maxTurns: parseMaxTurns(values['max-turns']),
    goal: values['goal'],
    goalMaxIterations: parseMaxTurns(values['goal-max-iterations']),
    forkSession: values['fork-session'] ?? false,
    movedFrom: values['moved-from'],
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
    safeMode: values['safe-mode'] ?? false,
    allowedTools: values['allowed-tools'],
    deniedTools: values['denied-tools'],
    model: values['model'],
    ...(values['fallback-model'] !== undefined && {
      fallbackModel: parseFallbackModelList(values['fallback-model']),
    }),
    effort: parseModelEffort(values['effort']),
    advisor: values['advisor'],
    preset: values['preset'],
    outputStyle: values['output-style'],
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

export function parseCliArgs(argv = process.argv.slice(2)): IParsedCliArgs {
  const { values, positionals } = parseArgs({ ...PARSE_ARGS_CONFIG, args: argv });
  if (values['external-event-allow'] !== undefined) {
    throw new Error(
      '--external-event-allow was retired: a sender name does not prove who sent an event. ' +
        'External events are admitted only by a grant whose access token the session verifies ' +
        '(--external-event-grant <file>).',
    );
  }
  const args: IParsedCliArgs = {
    ...mapParsedValues(values, positionals),
    ...resolveMemoryArgs(values),
    ...resolveScreenReaderArgs(values),
    ...resolveReducedMotionArgs(values),
  };
  if (
    args.mcpHttpPort !== undefined &&
    (!Number.isInteger(args.mcpHttpPort) || args.mcpHttpPort < 1 || args.mcpHttpPort > 65535)
  ) {
    throw new Error('--http-port must be an integer in 1..65535');
  }
  if (args.supervisedSessionId !== undefined) {
    if (
      !args.serve ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        args.supervisedSessionId,
      )
    ) {
      throw new Error('--supervised-session-id requires --serve and a valid generated UUID');
    }
  }
  if (args.supervisedExternalEventGrants === true && args.supervisedSessionId === undefined) {
    throw new Error('--supervised-external-event-grants is set only by a supervised launch');
  }
  if ((args.externalEventGrantFiles?.length ?? 0) > 0) {
    if (
      args.printMode ||
      args.goal !== undefined ||
      args.serve ||
      args.reset ||
      args.configure ||
      args.configureProvider !== undefined ||
      args.version ||
      args.checkUpdate ||
      args.help ||
      ['mcp', 'eval', 'session', 'user-local'].includes(args.positional[0] ?? '')
    ) {
      throw new Error(
        '--external-event-grant is available only in the interactive TUI; ' +
          'a background session takes it on `robota session start --background`',
      );
    }
    if (args.permissionMode === 'bypassPermissions') {
      throw new Error('--external-event-grant cannot run with bypassPermissions');
    }
  }
  const hasGrants =
    (args.externalEventGrantFiles?.length ?? 0) > 0 || args.supervisedExternalEventGrants === true;
  if (
    !hasGrants &&
    (args.externalEventPort !== undefined || args.externalEventTrustedProxies !== undefined)
  ) {
    throw new Error(
      '--external-event-port and --external-event-trusted-proxy go only with external event grants',
    );
  }
  if (hasGrants && args.externalEventPort === undefined) {
    throw new Error(
      '--external-event-grant needs --external-event-port: the loopback port the owner\'s proxy forwards to',
    );
  }
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

/** Flags a `/cd` never carries into the target session: what to resume, and what to run. */
const WORKSPACE_MOVE_DROPPED_OPTIONS = new Set([
  'continue',
  'resume',
  'fork-session',
  'moved-from',
  'restricted-workspace',
  // What this run was asked to do, not how: a move carries no prompt, task or replay input — and a
  // path value would be re-read against the target directory. `--name` would rename the copy.
  'name',
  'task-file',
  'session-log',
  'p',
  'goal',
  'goal-max-iterations',
]);

/**
 * The argv for the session a `/cd` starts (issue #3081): this run's own flags — provider, model,
 * permission mode, preset… — minus resume/prompt selection and positional input, plus the resume of
 * the copied conversation. Tokenised with the same parser config, so a flag's value is never
 * mistaken for a positional or dropped with it.
 */
export function buildWorkspaceMoveArgv(
  argv: readonly string[],
  move: { readonly resumeId: string; readonly movedFrom: string; readonly restricted: boolean },
): string[] {
  const { tokens } = parseArgs({ ...PARSE_ARGS_CONFIG, args: [...argv], tokens: true });
  const kept: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'positional' || token.kind === 'option-terminator') continue;
    if (WORKSPACE_MOVE_DROPPED_OPTIONS.has(token.name)) continue;
    // Inline form: a value that begins with `-` would otherwise read as a flag in the target run.
    kept.push(token.value === undefined ? `--${token.name}` : `--${token.name}=${token.value}`);
  }
  return [
    ...kept,
    '--resume',
    move.resumeId,
    '--moved-from',
    move.movedFrom,
    ...(move.restricted ? ['--restricted-workspace'] : []),
  ];
}
