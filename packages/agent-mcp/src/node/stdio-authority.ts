/** Canonical filesystem and environment authority for one local MCP process. */
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  IMCPStdioAdapterOptions,
  IMCPStdioAuthority,
  IMCPStdioInput,
  IMCPStdioSnapshot,
} from './stdio-types.js';

const MAX_FIELD_LENGTH = 16_384;
const MAX_ARGS = 128;
const MAX_ENV_KEYS = 128;
const DEFAULT_STARTUP_MS = 10_000;
const DEFAULT_CLEANUP_MS = 6_000;
const MAX_BUDGET_MS = 120_000;
const MIN_CLEANUP_MS = 4_100;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TEMPLATE = /\$\{[^}]*\}/;
const EXECUTION_ENV =
  /^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_.*|DYLD_.*|PYTHONPATH|PYTHONHOME|RUBYOPT|PERL5OPT|BASH_ENV|ENV)$/i;

/** Whether a variable changes what a runtime loads or executes, so no child MCP program inherits it. */
export function isExecutionEnvironmentName(name: string): boolean {
  return EXECUTION_ENV.test(name);
}
const SHELL_NAMES = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'cmd.exe',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
]);

function validField(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= MAX_FIELD_LENGTH &&
    !value.includes('\0') &&
    !TEMPLATE.test(value)
  );
}

function inside(root: string, child: string): boolean {
  const suffix = relative(root, child);
  return (
    suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
  );
}

function budget(value: number | undefined, fallback: number): number | undefined {
  const resolved = value ?? fallback;
  return Number.isInteger(resolved) && resolved > 0 && resolved <= MAX_BUDGET_MS
    ? resolved
    : undefined;
}

async function canonicalDirectory(path: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(path);
    return (await stat(canonical)).isDirectory() ? canonical : undefined;
  } catch {
    // allow-fallback: failed directory canonicalization denies subprocess authority before spawn.
    return undefined;
  }
}

async function canonicalFile(path: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(path);
    return (await stat(canonical)).isFile() ? canonical : undefined;
  } catch {
    // allow-fallback: failed executable canonicalization denies subprocess authority before spawn.
    return undefined;
  }
}

function lexicalTraversal(path: string): boolean {
  return path.split(/[\\/]/).includes('..');
}

export async function snapshotFor(
  input: IMCPStdioInput,
  authority: IMCPStdioAuthority,
): Promise<IMCPStdioSnapshot | undefined> {
  const definition = input.definition;
  const command = definition.command;
  const args = definition.args ?? [];
  if (
    definition.transport !== 'stdio' ||
    !validField(command) ||
    !isAbsolute(command) ||
    SHELL_NAMES.has(basename(command).toLowerCase()) ||
    !Array.isArray(args) ||
    args.length > MAX_ARGS ||
    args.some((arg) => !validField(arg, true))
  )
    return undefined;
  if (
    !validField(authority.allowedRoot) ||
    !isAbsolute(authority.allowedRoot) ||
    !validField(authority.generation)
  )
    return undefined;
  const startupMs = budget(authority.startupMs, DEFAULT_STARTUP_MS);
  const cleanupMs = budget(authority.cleanupMs, DEFAULT_CLEANUP_MS);
  if (startupMs === undefined || cleanupMs === undefined || cleanupMs < MIN_CLEANUP_MS)
    return undefined;
  const allowed = authority.executables.some(
    (executable) =>
      executable.command === command &&
      executable.args.some(
        (vector) =>
          vector.length === args.length && vector.every((part, index) => part === args[index]),
      ),
  );
  if (!allowed) return undefined;
  const canonicalRoot = await canonicalDirectory(authority.allowedRoot);
  const canonicalCommand = await canonicalFile(command);
  if (canonicalRoot === undefined || canonicalCommand === undefined) return undefined;
  const requestedCwd = definition.cwd ?? authority.allowedRoot;
  if (!validField(requestedCwd) || lexicalTraversal(requestedCwd)) return undefined;
  const cwd = await canonicalDirectory(resolve(canonicalRoot, requestedCwd));
  if (cwd === undefined || !inside(canonicalRoot, cwd)) return undefined;
  const requestedEnv = definition.env ?? {};
  const hostEnv = authority.environment ?? {};
  if (Object.keys(requestedEnv).length > MAX_ENV_KEYS || Object.keys(hostEnv).length > MAX_ENV_KEYS)
    return undefined;
  for (const [key, value] of Object.entries(hostEnv)) {
    if (
      !ENV_KEY.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      EXECUTION_ENV.test(key) ||
      !validField(value, true)
    )
      return undefined;
  }
  for (const [key, value] of Object.entries(requestedEnv)) {
    if (
      !ENV_KEY.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      EXECUTION_ENV.test(key) ||
      !validField(value, true) ||
      !authority.allowedEnvironmentKeys?.includes(key) ||
      !Object.hasOwn(hostEnv, key) ||
      hostEnv[key] !== value
    )
      return undefined;
  }
  return Object.freeze({
    command,
    canonicalCommand,
    args: Object.freeze([...args]),
    cwd,
    canonicalRoot,
    env: Object.freeze({ ...hostEnv }),
    requestedEnvKeys: Object.freeze(Object.keys(requestedEnv)),
    generation: authority.generation,
    startupMs,
    cleanupMs,
    activation: input.activation,
  });
}

export async function revalidateSnapshot(
  snapshot: IMCPStdioSnapshot,
  options: IMCPStdioAdapterOptions,
): Promise<boolean> {
  try {
    const current = options.admission.admit(snapshot.activation);
    if (
      !current.allowed ||
      current.status !== 'approved' ||
      options.authority.generation !== snapshot.generation
    )
      return false;
    const root = await canonicalDirectory(options.authority.allowedRoot);
    const cwd = await canonicalDirectory(snapshot.cwd);
    const command = await canonicalFile(snapshot.command);
    const executableAllowed = options.authority.executables.some(
      (executable) =>
        executable.command === snapshot.command &&
        executable.args.some(
          (vector) =>
            vector.length === snapshot.args.length &&
            vector.every((part, index) => part === snapshot.args[index]),
        ),
    );
    const currentEnv = options.authority.environment ?? {};
    const envUnchanged =
      Object.keys(currentEnv).length === Object.keys(snapshot.env).length &&
      Object.entries(currentEnv).every(([key, value]) => snapshot.env[key] === value);
    const keysAllowed = snapshot.requestedEnvKeys.every((key) =>
      options.authority.allowedEnvironmentKeys?.includes(key),
    );
    // This synchronous check is the last authority decision before SDK start. Revocation can land
    // while the filesystem awaits above; the earlier check alone cannot bind the spawn.
    const finalAdmission = options.admission.admit(snapshot.activation);
    return (
      finalAdmission.allowed &&
      finalAdmission.status === 'approved' &&
      options.authority.generation === snapshot.generation &&
      root === snapshot.canonicalRoot &&
      cwd === snapshot.cwd &&
      command === snapshot.canonicalCommand &&
      inside(root, cwd) &&
      executableAllowed &&
      envUnchanged &&
      keysAllowed
    );
  } catch {
    // allow-fallback: any revalidation error denies subprocess authority before spawn.
    return false;
  }
}
