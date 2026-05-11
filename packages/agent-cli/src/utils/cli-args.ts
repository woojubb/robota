/**
 * CLI argument parsing and validation.
 * Pure functions — no side effects beyond process.exit on validation failure.
 */

import { parseArgs } from 'node:util';
import type { TPermissionMode } from '@robota-sdk/agent-core';

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

const VALID_OUTPUT_FORMATS = ['text', 'json', 'stream-json'] as const;
export type TOutputFormat = (typeof VALID_OUTPUT_FORMATS)[number];

export interface IParsedCliArgs {
  positional: string[];
  printMode: boolean;
  continueMode: boolean;
  resumeId: string | undefined;
  model: string | undefined;
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
}

/** Validate and return a TOutputFormat from a raw CLI string, or exit on error. */
export function parseOutputFormat(raw: string | undefined): TOutputFormat | undefined {
  if (raw === undefined) return undefined;
  if (!(VALID_OUTPUT_FORMATS as readonly string[]).includes(raw)) {
    process.stderr.write(
      `Invalid --output-format "${raw}". Valid: ${VALID_OUTPUT_FORMATS.join(' | ')}\n`,
    );
    process.exit(1);
  }
  return raw as TOutputFormat;
}

/** Validate and return a TPermissionMode from a raw CLI string, or exit on error. */
export function parsePermissionMode(raw: string | undefined): TPermissionMode | undefined {
  if (raw === undefined) return undefined;
  if (!VALID_MODES.includes(raw as TPermissionMode)) {
    process.stderr.write(`Invalid --permission-mode "${raw}". Valid: ${VALID_MODES.join(' | ')}\n`);
    process.exit(1);
  }
  return raw as TPermissionMode;
}

/** Validate and return a positive integer from a raw CLI string, or exit on error. */
export function parseMaxTurns(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    process.stderr.write(`Invalid --max-turns "${raw}". Must be a positive integer.\n`);
    process.exit(1);
  }
  return n;
}

/** Parse and validate CLI arguments. */
export function parseCliArgs(): IParsedCliArgs {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      p: { type: 'boolean', short: 'p', default: false },
      continue: { type: 'boolean', short: 'c', default: false },
      resume: { type: 'string', short: 'r' },
      model: { type: 'string' },
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
    },
  });

  return {
    positional: positionals,
    printMode: values['p'] ?? false,
    continueMode: values['continue'] ?? false,
    resumeId: values['resume'],
    model: values['model'],
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
  };
}
