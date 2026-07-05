import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';

export const ALIASES_FILE = join('.dag', 'aliases.json');

const ALIAS_HELP = `Usage: dag alias <subcommand> [args]

Manage short-named aliases for frequently used pipelines.

Subcommands:
  dag alias add <name> "<pipeline>"   Register an alias
  dag alias list                      List all aliases
  dag alias remove <name>             Delete an alias

Aliases are stored in .dag/aliases.json and can be used as:
  dag run @<name> --input text="..."
  dag run --pipeline @<name>

Examples:
  dag alias add summarize "input | llm-text-anthropic | text-output"
  dag alias list
  dag run @summarize --input text="Hello"
`;

export interface IAliasCommandOptions {
  readonly io: IDagCliIo;
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readAliases(): Promise<Record<string, string>> {
  try {
    const text = await readFile(ALIASES_FILE, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    // allow-fallback: missing or malformed file treated as empty alias map
    return {};
  }
}

async function writeAliases(aliases: Record<string, string>): Promise<void> {
  await mkdir(join('.dag'), { recursive: true });
  await writeFile(ALIASES_FILE, JSON.stringify(aliases, null, 2) + '\n', 'utf8');
}

function validateAliasName(name: string): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return `Alias name must contain only letters, numbers, hyphens, and underscores. Got: "${name}".`;
  }
  return null;
}

async function addAlias(name: string, pipeline: string, io: IDagCliIo): Promise<number> {
  const nameError = validateAliasName(name);
  if (nameError) {
    io.write(`Error: ${nameError}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const aliases = await readAliases();
  aliases[name] = pipeline;

  try {
    await writeAliases(aliases);
  } catch (writeErr) {
    // allow-fallback: file write failure reported as structured error
    io.write(`Error: Failed to save alias: ${resolveErrorMessage(writeErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  io.write(`Alias added: @${name}\n`);
  io.write(`Run:         dag run @${name} --input text="..."\n`);
  return SUCCESS_EXIT_CODE;
}

async function listAliases(io: IDagCliIo): Promise<number> {
  const aliases = await readAliases();
  const entries = Object.entries(aliases);
  if (entries.length === 0) {
    io.write('No aliases defined. Use: dag alias add <name> "<pipeline>"\n');
    return SUCCESS_EXIT_CODE;
  }
  const maxLen = Math.max(...entries.map(([k]) => k.length));
  for (const [name, pipeline] of entries) {
    io.write(`@${name.padEnd(maxLen)}  →  ${pipeline}\n`);
  }
  return SUCCESS_EXIT_CODE;
}

async function removeAlias(name: string, io: IDagCliIo): Promise<number> {
  const aliases = await readAliases();
  if (!(name in aliases)) {
    io.write(`Error: Alias "@${name}" not found.\n`);
    return FAILURE_EXIT_CODE;
  }
  delete aliases[name];
  try {
    await writeAliases(aliases);
  } catch (writeErr) {
    // allow-fallback: file write failure reported as structured error
    io.write(`Error: Failed to update aliases: ${resolveErrorMessage(writeErr)}\n`);
    return FAILURE_EXIT_CODE;
  }
  io.write(`Alias removed: @${name}\n`);
  return SUCCESS_EXIT_CODE;
}

export async function aliasCommand(
  args: readonly string[],
  options: IAliasCommandOptions,
): Promise<number> {
  const { io } = options;

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    io.write(ALIAS_HELP);
    return SUCCESS_EXIT_CODE;
  }

  const subcommand = args[0];

  if (subcommand === 'add') {
    const name = args[1];
    const pipeline = args[2];
    if (!name) {
      io.write('Error: alias add requires <name>.\n');
      return USAGE_ERROR_EXIT_CODE;
    }
    if (!pipeline) {
      io.write('Error: alias add requires "<pipeline>".\n');
      return USAGE_ERROR_EXIT_CODE;
    }
    return addAlias(name, pipeline, io);
  }

  if (subcommand === 'list') {
    return listAliases(io);
  }

  if (subcommand === 'remove') {
    const name = args[1];
    if (!name) {
      io.write('Error: alias remove requires <name>.\n');
      return USAGE_ERROR_EXIT_CODE;
    }
    return removeAlias(name, io);
  }

  io.write(`Error: Unknown alias subcommand "${subcommand}". Valid: add, list, remove.\n`);
  return USAGE_ERROR_EXIT_CODE;
}

/**
 * Resolve an alias reference (e.g. "@summarize") to its pipeline spec string.
 * Returns the resolved spec or null if not an alias reference.
 */
export async function resolveAliasRef(ref: string): Promise<string | null> {
  if (!ref.startsWith('@')) return null;
  const name = ref.slice(1);
  const aliases = await readAliases();
  return aliases[name] ?? null;
}
