/**
 * Flag wiring guard (HARNESS-006).
 *
 * Every field parsed into IParsedCliArgs must have at least one consumer
 * outside cli-args.ts — the CLI-053/054 incident class was flags parsed,
 * advertised in help, and silently never read (--denied-tools, --dry-run).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(__dirname, '../..');
const CLI_ARGS_PATH = resolve(__dirname, '../cli-args.ts');

/**
 * Fields consumed entirely inside parseCliArgs (normalization), with reasons.
 * Adding a field here requires a written reason — silent additions defeat the guard.
 */
const PARSE_INTERNAL_FIELDS = new Map<string, string>([
  ['dryRun', 'normalized to permissionMode: plan inside parseCliArgs (CLI-054 alias)'],
  [
    'disableUpdateCheck',
    'consumed cross-package via shouldRunStartupCliUpdateCheck(args) in agent-framework update-check.ts:166 (whole-args pass-through from command-setup.ts)',
  ],
]);

function extractParsedArgsFields(): string[] {
  const source = readFileSync(CLI_ARGS_PATH, 'utf8');
  const match = source.match(/export interface IParsedCliArgs \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('IParsedCliArgs interface not found in cli-args.ts');
  const fields: string[] = [];
  for (const line of match[1].split('\n')) {
    const fieldMatch = line.match(/^\s*(\w+)\s*[:?]/);
    if (fieldMatch) fields.push(fieldMatch[1]);
  }
  return fields;
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function consumerCorpus(): string {
  return collectSourceFiles(SRC_ROOT)
    .filter((file) => file !== CLI_ARGS_PATH)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

describe('IParsedCliArgs wiring', () => {
  it('TC-01: every parsed field has a consumer outside cli-args.ts (or a reasoned allowlist entry)', () => {
    const fields = extractParsedArgsFields();
    expect(fields.length).toBeGreaterThan(20);

    const corpus = consumerCorpus();
    const unconsumed = fields.filter((field) => {
      if (PARSE_INTERNAL_FIELDS.has(field)) return false;
      return !new RegExp(`\\b${field}\\b`).test(corpus);
    });

    expect(
      unconsumed,
      `Parsed but never consumed (CLI-053/054 incident class): ${unconsumed.join(', ')} — ` +
        'wire the flag or add a reasoned PARSE_INTERNAL_FIELDS entry',
    ).toEqual([]);
  });

  it('TC-02: the search logic detects wired and unwired names correctly', () => {
    const corpus = consumerCorpus();
    expect(new RegExp('\\bdeniedTools\\b').test(corpus)).toBe(true);
    expect(new RegExp('\\btotallyFakeUnusedFlagName\\b').test(corpus)).toBe(false);
  });

  it('TC-02: extractor enumerates known fields', () => {
    const fields = extractParsedArgsFields();
    for (const known of ['deniedTools', 'allowedTools', 'dryRun', 'printMode', 'positional']) {
      expect(fields).toContain(known);
    }
  });

  it('allowlist entries must still exist as parser fields', () => {
    const fields = new Set(extractParsedArgsFields());
    for (const allowlisted of PARSE_INTERNAL_FIELDS.keys()) {
      expect(fields.has(allowlisted), `${allowlisted} is allowlisted but no longer parsed`).toBe(
        true,
      );
    }
  });
});
