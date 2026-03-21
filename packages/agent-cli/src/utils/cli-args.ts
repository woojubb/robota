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
  permissionMode: TPermissionMode | undefined;
  maxTurns: number | undefined;
  version: boolean;
  reset: boolean;
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
      c: { type: 'boolean', short: 'c', default: false },
      r: { type: 'string', short: 'r' },
      model: { type: 'string' },
      'permission-mode': { type: 'string' },
      'max-turns': { type: 'string' },
      version: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
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
    reset: values['reset'] ?? false,
  };
}
