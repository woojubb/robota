import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEYS_HELP_TEXT = `dag keys — manage API keys stored in .dag/.env

Usage:
  dag keys add <provider>       Add or update an API key
  dag keys list                 List all providers and their key status
  dag keys remove <provider>    Remove an API key from .dag/.env
  dag keys test                 Check key presence and format for all providers

Providers:
  anthropic     ANTHROPIC_API_KEY
  openai        OPENAI_API_KEY
  gemini        GEMINI_API_KEY
  deepseek      DEEPSEEK_API_KEY
  qwen          DASHSCOPE_API_KEY

Keys are stored in .dag/.env (one KEY=value per line).
`;

// ---------------------------------------------------------------------------
// Provider mapping
// ---------------------------------------------------------------------------

interface IProviderSpec {
  readonly provider: string;
  readonly envVar: string;
  readonly keyPrefix?: string;
  readonly url: string;
  readonly buildPingRequest?: (key: string) => { url: string; headers: Record<string, string> };
}

const PROVIDER_SPECS: readonly IProviderSpec[] = [
  {
    provider: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    url: 'https://console.anthropic.com/',
    buildPingRequest: (key) => ({
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    }),
  },
  {
    provider: 'openai',
    envVar: 'OPENAI_API_KEY',
    keyPrefix: 'sk-',
    url: 'https://platform.openai.com/api-keys',
    buildPingRequest: (key) => ({
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${key}` },
    }),
  },
  {
    provider: 'gemini',
    envVar: 'GEMINI_API_KEY',
    url: 'https://makersuite.google.com/app/apikey',
    buildPingRequest: (key) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
      headers: {},
    }),
  },
  {
    provider: 'deepseek',
    envVar: 'DEEPSEEK_API_KEY',
    url: 'https://platform.deepseek.com/',
    buildPingRequest: (key) => ({
      url: 'https://api.deepseek.com/models',
      headers: { Authorization: `Bearer ${key}` },
    }),
  },
  {
    provider: 'qwen',
    envVar: 'DASHSCOPE_API_KEY',
    url: 'https://dashscope.aliyuncs.com/',
    // no buildPingRequest — no lightweight ping endpoint
  },
];

function findProviderSpec(provider: string): IProviderSpec | undefined {
  return PROVIDER_SPECS.find((s) => s.provider === provider.toLowerCase());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IKeysCommandOptions {
  readonly io: IDagCliIo;
  readonly cwd?: string;
}

type TParseResult =
  | {
      readonly ok: true;
      readonly subcommand: string;
      readonly rest: readonly string[];
      readonly skipVerify: boolean;
    }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseKeysArgv(args: readonly string[]): TParseResult {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return { ok: false, exitCode: SUCCESS_EXIT_CODE, message: KEYS_HELP_TEXT };
  }

  const subcommand = args[0] ?? '';
  const remaining = args.slice(1);
  const skipVerify = remaining.includes('--skip-verify');
  const rest = remaining.filter((a) => a !== '--skip-verify');

  const validSubcommands = ['add', 'list', 'remove', 'test'];
  if (!validSubcommands.includes(subcommand)) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Unknown keys subcommand "${subcommand}". Valid: ${validSubcommands.join(', ')}.`,
    };
  }

  return { ok: true, subcommand, rest, skipVerify };
}

// ---------------------------------------------------------------------------
// .dag/.env file I/O
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false, // allow-fallback: fs.access throws on not-found; false is the correct semantic
  );
}

async function readEnvFile(envPath: string): Promise<string[]> {
  const exists = await pathExists(envPath);
  if (!exists) return [];
  try {
    const text = await readFile(envPath, 'utf8');
    return text.split('\n');
  } catch {
    // allow-fallback: unreadable env file treated as empty; caller will report error if write also fails
    return [];
  }
}

async function writeEnvFile(envPath: string, lines: string[]): Promise<void> {
  const dir = dirname(envPath);
  const dirExists = await pathExists(dir);
  if (!dirExists) {
    await mkdir(dir, { recursive: true });
  }
  // Ensure the file ends with a newline
  const content = lines.join('\n').replace(/\n+$/, '') + '\n';
  await writeFile(envPath, content, 'utf8');
}

/**
 * Parse lines from a .env file into a key-value map.
 * Ignores comments and blank lines.
 */
function parseEnvLines(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    map.set(key, value);
  }
  return map;
}

/**
 * Rebuild the env file lines from a key-value map, preserving comments and
 * ordering from the original lines where possible.
 */
function rebuildEnvLines(originalLines: string[], updates: Map<string, string>): string[] {
  const written = new Set<string>();
  const result: string[] = [];

  for (const line of originalLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      result.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (updates.has(key)) {
      const newVal = updates.get(key);
      if (newVal === undefined) {
        // Key was deleted — skip this line
        written.add(key);
        continue;
      }
      result.push(`${key}=${newVal}`);
      written.add(key);
    } else {
      result.push(line);
    }
  }

  // Append new keys that weren't in the original file
  for (const [key, value] of updates) {
    if (!written.has(key) && value !== undefined) {
      result.push(`${key}=${value}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Key masking
// ---------------------------------------------------------------------------

const MASK_PREFIX_LEN = 10;
const MASK_SUFFIX_LEN = 6;
const MASK_PLACEHOLDER = '***';
const MIN_MASKABLE_LEN = MASK_PREFIX_LEN + MASK_SUFFIX_LEN + 1;

function maskKey(value: string): string {
  if (value.length < MIN_MASKABLE_LEN) {
    return MASK_PLACEHOLDER;
  }
  return (
    value.slice(0, MASK_PREFIX_LEN) + MASK_PLACEHOLDER + value.slice(value.length - MASK_SUFFIX_LEN)
  );
}

// ---------------------------------------------------------------------------
// Key format validation
// ---------------------------------------------------------------------------

function validateKeyFormat(spec: IProviderSpec, value: string): boolean {
  if (value.length < 10) return false;
  if (spec.keyPrefix !== undefined) {
    return value.startsWith(spec.keyPrefix);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Live API ping
// ---------------------------------------------------------------------------

async function pingProviderKey(
  spec: IProviderSpec,
  key: string,
): Promise<'valid' | 'invalid' | 'skip' | 'error'> {
  if (!spec.buildPingRequest) return 'skip';
  const { url, headers } = spec.buildPingRequest(key);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeout);
    if (response.status === 200 || response.status === 206) return 'valid';
    if (response.status === 401 || response.status === 403) return 'invalid';
    return 'error';
  } catch {
    // allow-fallback: network errors and AbortError are both treated as 'error'; no terminal failure
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Subcommand implementations
// ---------------------------------------------------------------------------

async function promptSecret(prompt: string): Promise<string> {
  return new Promise((res) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

async function tryWriteEnvFile(
  envPath: string,
  updated: string[],
  io: IDagCliIo,
): Promise<boolean> {
  try {
    // allow-fallback: write failure is surfaced as a user-visible error
    await writeEnvFile(envPath, updated);
    return true;
  } catch (writeErr) {
    // allow-fallback: write failure surfaced as error message
    io.write(
      `Error: Failed to write .dag/.env: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}\n`,
    );
    return false;
  }
}

async function keysAdd(
  rest: readonly string[],
  envPath: string,
  io: IDagCliIo,
  skipVerify: boolean,
): Promise<number> {
  const provider = rest[0];
  if (typeof provider !== 'string' || provider.length === 0) {
    io.write('Error: keys add requires a provider name. Example: dag keys add anthropic\n');
    return USAGE_ERROR_EXIT_CODE;
  }

  const spec = findProviderSpec(provider);
  if (spec === undefined) {
    const known = PROVIDER_SPECS.map((s) => s.provider).join(', ');
    io.write(`Error: Unknown provider "${provider}". Known providers: ${known}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const rawKey = await promptSecret(`Paste your ${spec.provider} API key: `);
  if (rawKey.length === 0) {
    io.write('Error: No key entered. Aborted.\n');
    return FAILURE_EXIT_CODE;
  }

  const lines = await readEnvFile(envPath);
  const existing = parseEnvLines(lines);
  existing.set(spec.envVar, rawKey);
  const updated = rebuildEnvLines(lines, existing);

  const wrote = await tryWriteEnvFile(envPath, updated, io);
  if (!wrote) return FAILURE_EXIT_CODE;

  const isFormatValid = validateKeyFormat(spec, rawKey);
  if (isFormatValid) {
    if (!skipVerify) {
      io.write(`  Verifying key with API... `);
      const pingResult = await pingProviderKey(spec, rawKey);
      if (pingResult === 'valid') {
        io.write(`✓ verified\n`);
      } else if (pingResult === 'invalid') {
        io.write(`✗ rejected by API — double-check your key\n`);
        io.write(`  Key saved to .dag/.env. Run 'dag keys test' to retry.\n`);
        return SUCCESS_EXIT_CODE;
      } else if (pingResult === 'error') {
        io.write(`⚠ could not reach API (network?)\n`);
      }
    }
    io.write(`✓ ${spec.envVar} saved (format valid)\n`);
    io.write(`\nTry it now:\n`);
    if (spec.provider === 'anthropic') {
      io.write(
        `  dag run --pipeline "input | llm-text-anthropic | text-output" --input text="Hello"\n`,
      );
    } else if (spec.provider === 'openai') {
      io.write(
        `  dag run --pipeline "input | llm-text-openai | text-output" --input text="Hello"\n`,
      );
    } else {
      io.write(
        `  dag run --pipeline "input | llm-text-${spec.provider} | text-output" --input text="Hello"\n`,
      );
    }
  } else {
    const prefixHint =
      spec.keyPrefix !== undefined ? ` (expected ${spec.keyPrefix}... prefix)` : '';
    io.write(
      `⚠  Warning: ${spec.envVar} format does not look right${prefixHint}\n  Key saved to .dag/.env — verify it works before relying on it.\n`,
    );
  }
  return SUCCESS_EXIT_CODE;
}

async function keysList(envPath: string, io: IDagCliIo): Promise<number> {
  const lines = await readEnvFile(envPath);
  const envMap = parseEnvLines(lines);

  const COL_PROVIDER = 12;
  const COL_KEY = 24;

  const header = `${'Provider'.padEnd(COL_PROVIDER)} ${'Key (masked)'.padEnd(COL_KEY)} Status`;
  io.write(header + '\n');
  io.write('-'.repeat(header.length) + '\n');

  for (const spec of PROVIDER_SPECS) {
    const value = envMap.get(spec.envVar);
    const isSet = typeof value === 'string' && value.length > 0;
    const keyDisplay = isSet ? maskKey(value as string) : '(not set)';
    const status = isSet ? '✓ configured' : '✗ missing';
    io.write(`${spec.provider.padEnd(COL_PROVIDER)} ${keyDisplay.padEnd(COL_KEY)} ${status}\n`);
  }

  return SUCCESS_EXIT_CODE;
}

async function keysRemove(
  rest: readonly string[],
  envPath: string,
  io: IDagCliIo,
): Promise<number> {
  const provider = rest[0];
  if (typeof provider !== 'string' || provider.length === 0) {
    io.write('Error: keys remove requires a provider name. Example: dag keys remove openai\n');
    return USAGE_ERROR_EXIT_CODE;
  }

  const spec = findProviderSpec(provider);
  if (spec === undefined) {
    const known = PROVIDER_SPECS.map((s) => s.provider).join(', ');
    io.write(`Error: Unknown provider "${provider}". Known providers: ${known}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const lines = await readEnvFile(envPath);
  const existing = parseEnvLines(lines);

  if (!existing.has(spec.envVar)) {
    io.write(`${spec.envVar} was not set in .dag/.env\n`);
    return SUCCESS_EXIT_CODE;
  }

  // Mark for deletion by setting to undefined in the updates map
  const updates = new Map<string, string>(existing);
  updates.delete(spec.envVar);

  // Rebuild lines, filtering out the deleted key
  const updatedLines = rebuildEnvLines(lines, updates);

  try {
    await writeEnvFile(envPath, updatedLines);
  } catch (err) {
    // allow-fallback: write failure is surfaced as an error message
    io.write(
      `Error: Failed to write .dag/.env: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return FAILURE_EXIT_CODE;
  }

  io.write(`✓ ${spec.envVar} removed from .dag/.env\n`);
  return SUCCESS_EXIT_CODE;
}

async function keysTest(envPath: string, io: IDagCliIo): Promise<number> {
  const lines = await readEnvFile(envPath);
  const envMap = parseEnvLines(lines);

  let allValid = true;

  for (const spec of PROVIDER_SPECS) {
    const value = envMap.get(spec.envVar) ?? process.env[spec.envVar];
    const isSet = typeof value === 'string' && value.length > 0;

    if (!isSet) {
      io.write(`${spec.provider}: (not set)  ✗ missing\n`);
      io.write(`  → Get a key: ${spec.url}\n`);
      allValid = false;
      continue;
    }

    const isFormatValid = validateKeyFormat(spec, value as string);
    const masked = maskKey(value as string);
    if (isFormatValid) {
      io.write(`${spec.provider}: ${masked}  ✓ present (format looks valid)\n`);
    } else {
      io.write(`${spec.provider}: ${masked}  ⚠ present but format may be invalid\n`);
      allValid = false;
    }
  }

  if (!allValid) {
    io.write('\nTip: Run dag doctor for a full environment check.\n');
  }

  return allValid ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Execute the `dag keys <subcommand>` command.
 *
 * @param args - The argv slice starting after the `keys` keyword.
 * @param options - IO abstraction and optional working directory.
 * @returns Exit code (0 = success, 1 = failure, 2 = usage error).
 */
export async function keysCommand(
  args: readonly string[],
  options: IKeysCommandOptions,
): Promise<number> {
  const { io, cwd = process.cwd() } = options;

  const parseResult = parseKeysArgv(args);
  if (!parseResult.ok) {
    io.write(
      parseResult.exitCode === SUCCESS_EXIT_CODE
        ? parseResult.message
        : `Error: ${parseResult.message}\n`,
    );
    return parseResult.exitCode;
  }

  const { subcommand, rest, skipVerify } = parseResult;
  const envPath = join(cwd, '.dag', '.env');

  switch (subcommand) {
    case 'add':
      return keysAdd(rest, envPath, io, skipVerify);
    case 'list':
      return keysList(envPath, io);
    case 'remove':
      return keysRemove(rest, envPath, io);
    case 'test':
      return keysTest(envPath, io);
    default:
      io.write(`Error: Unknown subcommand "${subcommand}".\n`);
      return USAGE_ERROR_EXIT_CODE;
  }
}
