/**
 * CLI argument parsing and validation.
 * Pure functions — no side effects beyond process.exit on validation failure.
 */

import { parseArgs } from 'node:util';
import type { TPermissionMode } from '@robota-sdk/agent-core';

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

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
  outputFormat: string | undefined;
  systemPrompt: string | undefined;
  appendSystemPrompt: string | undefined;
  version: boolean;
  reset: boolean;
  bare: boolean;
  allowedTools: string | undefined;
  noSessionPersistence: boolean;
  jsonSchema: string | undefined;
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
      'system-prompt': { type: 'string' },
      'append-system-prompt': { type: 'string' },
      version: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      bare: { type: 'boolean', default: false },
      'allowed-tools': { type: 'string' },
      'no-session-persistence': { type: 'boolean', default: false },
      'json-schema': { type: 'string' },
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
    outputFormat: values['output-format'],
    systemPrompt: values['system-prompt'],
    appendSystemPrompt: values['append-system-prompt'],
    version: values['version'] ?? false,
    reset: values['reset'] ?? false,
    bare: values['bare'] ?? false,
    allowedTools: values['allowed-tools'],
    noSessionPersistence: values['no-session-persistence'] ?? false,
    jsonSchema: values['json-schema'],
  };
}
