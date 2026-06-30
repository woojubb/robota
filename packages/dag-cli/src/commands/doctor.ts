import { access, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE } from '../types.js';

const OUTPUT_FORMAT_PRETTY = 'pretty';
const OUTPUT_FORMAT_JSON = 'json';
const JSON_INDENT_SPACES = 2;
const NODE_MIN_MAJOR = 18;

type TCheckStatus = 'ok' | 'error' | 'warning';

interface IDoctorCheck {
  readonly name: string;
  readonly status: TCheckStatus;
  readonly detail?: string;
  readonly fix?: string;
  readonly url?: string;
}

interface IDoctorResult {
  readonly ok: boolean;
  readonly checks: readonly IDoctorCheck[];
  readonly errorCount: number;
  readonly warningCount: number;
}

export interface IDoctorCommandOptions {
  readonly io: IDagCliIo;
  readonly cwd?: string;
}

type TParseResult =
  | { readonly ok: true; readonly outputFormat: string; readonly savePath: string | undefined }
  | { readonly ok: false; readonly message: string };

function parseDoctorArgv(args: readonly string[]): TParseResult {
  const mutableArgs = [...args];
  let outputFormat = OUTPUT_FORMAT_PRETTY;
  let savePath: string | undefined;

  const jsonFlagIdx = mutableArgs.indexOf('--json');
  if (jsonFlagIdx !== -1) {
    outputFormat = OUTPUT_FORMAT_JSON;
    mutableArgs.splice(jsonFlagIdx, 1);
  }

  const outputIndex = mutableArgs.indexOf('--output');
  if (outputIndex !== -1) {
    const outputValue = mutableArgs[outputIndex + 1];
    if (typeof outputValue !== 'string' || outputValue.startsWith('--')) {
      return { ok: false, message: '--output requires a value.' };
    }
    if (outputValue !== OUTPUT_FORMAT_PRETTY && outputValue !== OUTPUT_FORMAT_JSON) {
      return { ok: false, message: '--output must be "json" or "pretty".' };
    }
    outputFormat = outputValue;
    mutableArgs.splice(outputIndex, 2);
  }

  const saveIndex = mutableArgs.indexOf('--save');
  if (saveIndex !== -1) {
    const saveValue = mutableArgs[saveIndex + 1];
    if (typeof saveValue !== 'string' || saveValue.startsWith('--')) {
      return { ok: false, message: '--save requires a file path.' };
    }
    savePath = saveValue;
    outputFormat = OUTPUT_FORMAT_JSON;
    mutableArgs.splice(saveIndex, 2);
  }

  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return { ok: false, message: `doctor received unexpected flags: ${unknownFlags.join(' ')}.` };
  }

  return { ok: true, outputFormat, savePath };
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false, // allow-fallback: fs.access throws on not-found; false is the correct semantic
  );
}

function resolveCliVersion(): string {
  try {
    const require = createRequire(fileURLToPath(import.meta.url));
    const pkgPath = require.resolve('@robota-sdk/dag-cli/package.json');
    const pkg = require(pkgPath) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    // allow-fallback: package.json self-resolution fails in some environments; fallback to relative path
    try {
      const require = createRequire(fileURLToPath(import.meta.url));
      const pkg = require('../../../package.json') as { version?: string };
      return typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
      // allow-fallback: all resolution paths failed; return unknown rather than crashing doctor
      return 'unknown';
    }
  }
}

function checkNodeVersion(): IDoctorCheck {
  const raw = process.version; // e.g. "v22.14.0"
  const versionStr = raw.startsWith('v') ? raw.slice(1) : raw;
  const major = parseInt(versionStr.split('.')[0] ?? '0', 10);

  if (major >= NODE_MIN_MAJOR) {
    return {
      name: 'node-version',
      status: 'ok',
      detail: `Node.js ${versionStr} (>= ${NODE_MIN_MAJOR}.0.0 required)`,
    };
  }
  return {
    name: 'node-version',
    status: 'error',
    detail: `Node.js ${versionStr} — must be >= ${NODE_MIN_MAJOR}.0.0`,
    fix: `Install Node.js >= ${NODE_MIN_MAJOR}.0.0 from https://nodejs.org/`,
  };
}

async function checkDagDirectory(cwd: string): Promise<IDoctorCheck> {
  const dagDir = join(cwd, '.dag');
  const exists = await pathExists(dagDir);
  if (exists) {
    return { name: '.dag-directory', status: 'ok', detail: '.dag/ directory exists' };
  }
  return {
    name: '.dag-directory',
    status: 'error',
    detail: '.dag/ directory not found',
    fix: 'dag init',
  };
}

async function checkEnvFile(cwd: string): Promise<IDoctorCheck> {
  const envPath = join(cwd, '.dag', '.env');
  const exists = await pathExists(envPath);
  if (exists) {
    return { name: 'env-file', status: 'ok', detail: '.dag/.env found' };
  }
  return {
    name: 'env-file',
    status: 'error',
    detail: '.dag/.env not found',
    fix: 'cp .dag/.env.example .dag/.env',
  };
}

interface IApiKeySpec {
  readonly envVar: string;
  readonly required: boolean;
  readonly url: string;
  readonly note?: string;
}

const API_KEY_SPECS: readonly IApiKeySpec[] = [
  {
    envVar: 'ANTHROPIC_API_KEY',
    required: true,
    url: 'https://console.anthropic.com/',
  },
  {
    envVar: 'OPENAI_API_KEY',
    required: true,
    url: 'https://platform.openai.com/api-keys',
  },
  {
    envVar: 'GEMINI_API_KEY',
    required: false,
    url: 'https://makersuite.google.com/app/apikey',
    note: 'optional — only needed for Gemini nodes',
  },
  {
    envVar: 'DEEPSEEK_API_KEY',
    required: false,
    url: 'https://platform.deepseek.com/',
    note: 'optional — only needed for DeepSeek nodes',
  },
];

function checkApiKey(spec: IApiKeySpec): IDoctorCheck {
  const value = process.env[spec.envVar];
  const isSet = typeof value === 'string' && value.trim().length > 0;

  if (isSet) {
    return { name: spec.envVar, status: 'ok', detail: `${spec.envVar} set` };
  }

  if (spec.required) {
    return {
      name: spec.envVar,
      status: 'error',
      detail: `${spec.envVar} not set`,
      fix: `echo '${spec.envVar}=your-key' >> .dag/.env`,
      url: spec.url,
    };
  }

  return {
    name: spec.envVar,
    status: 'warning',
    detail: `${spec.envVar} not set${spec.note !== undefined ? `  (${spec.note})` : ''}`,
    url: spec.url,
  };
}

interface IDagJsonValidation {
  readonly filePath: string;
  readonly nodeCount: number | null;
  readonly error: string | null;
}

async function validateDagJsonFile(filePath: string, io: IDagCliIo): Promise<IDagJsonValidation> {
  let text: string;
  try {
    text = await io.readTextFile(filePath);
  } catch {
    // allow-fallback: unreadable file is reported as a diagnostic error, not a crash
    return { filePath, nodeCount: null, error: 'failed to read file' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // allow-fallback: invalid JSON is reported as a diagnostic error, not a crash
    return { filePath, nodeCount: null, error: 'invalid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { filePath, nodeCount: null, error: 'root must be a JSON object' };
  }

  const obj = parsed as Record<string, unknown>;
  const nodes = obj['nodes'];
  const nodeCount = Array.isArray(nodes) ? nodes.length : null;

  return { filePath, nodeCount, error: null };
}

async function checkDagWorkflowFiles(cwd: string, io: IDagCliIo): Promise<IDoctorCheck[]> {
  const workflowsDir = join(cwd, '.dag', 'workflows');
  const dagDirExists = await pathExists(workflowsDir);

  if (!dagDirExists) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(workflowsDir);
  } catch {
    // allow-fallback: unreadable workflows dir is skipped gracefully in doctor output
    return [];
  }

  const dagJsonFiles = entries.filter((f) => f.endsWith('.dag.json'));
  if (dagJsonFiles.length === 0) {
    return [];
  }

  const checks: IDoctorCheck[] = [];
  for (const fileName of dagJsonFiles) {
    const fullPath = join(workflowsDir, fileName);
    const result = await validateDagJsonFile(fullPath, io);
    if (result.error !== null) {
      checks.push({
        name: `workflow:${fileName}`,
        status: 'error',
        detail: `${fileName}: ${result.error}`,
        fix: `dag validate .dag/workflows/${fileName}`,
      });
    } else {
      const nodeLabel = result.nodeCount !== null ? `${result.nodeCount} nodes` : '';
      checks.push({
        name: `workflow:${fileName}`,
        status: 'ok',
        detail:
          nodeLabel.length > 0
            ? `${fileName} found and valid (${nodeLabel})`
            : `${fileName} found and valid`,
      });
    }
  }
  return checks;
}

function renderPretty(cliVersion: string, result: IDoctorResult, io: IDagCliIo): void {
  io.write(`✓ dag-cli v${cliVersion}\n`);

  for (const check of result.checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warning' ? '⚠' : '✗';
    const label = check.detail !== undefined ? check.detail : check.name;
    io.write(`${icon} ${label}\n`);

    if (check.fix !== undefined) {
      io.write(`  → ${check.fix}\n`);
    }
    if (check.url !== undefined) {
      io.write(`  → ${check.url}\n`);
    }
  }

  io.write('\n');

  if (result.ok) {
    io.write('All checks passed.\n');
  } else {
    const parts: string[] = [];
    if (result.errorCount > 0) {
      parts.push(`${result.errorCount} error${result.errorCount === 1 ? '' : 's'}`);
    }
    if (result.warningCount > 0) {
      parts.push(`${result.warningCount} warning${result.warningCount === 1 ? '' : 's'}`);
    }
    io.write(`${parts.join(', ')} found. Fix the errors above and re-run: dag doctor\n`);
  }
}

async function runChecks(cwd: string, io: IDagCliIo): Promise<IDoctorCheck[]> {
  const checks: IDoctorCheck[] = [];

  checks.push(checkNodeVersion());
  checks.push(await checkDagDirectory(cwd));
  checks.push(await checkEnvFile(cwd));

  for (const spec of API_KEY_SPECS) {
    checks.push(checkApiKey(spec));
  }

  const workflowChecks = await checkDagWorkflowFiles(cwd, io);
  checks.push(...workflowChecks);

  return checks;
}

/**
 * Execute the `dag doctor` subcommand.
 *
 * @param args - The argv slice starting after the `doctor` keyword.
 * @param options - IO abstraction and optional working directory.
 * @returns Exit code (0 = all clear or warnings only, 1 = errors found, 2 = usage error).
 */
export async function doctorCommand(
  args: readonly string[],
  options: IDoctorCommandOptions,
): Promise<number> {
  const { io, cwd = process.cwd() } = options;

  const parseResult = parseDoctorArgv(args);
  if (!parseResult.ok) {
    io.write(
      `Error: ${parseResult.message}\nUsage: dag doctor [--json] [--output json] [--save <path>]\n`,
    );
    return 2;
  }

  const { outputFormat, savePath } = parseResult;
  const cliVersion = resolveCliVersion();
  const checks = await runChecks(cwd, io);

  const errorCount = checks.filter((c) => c.status === 'error').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const ok = errorCount === 0;

  const result: IDoctorResult = { ok, checks, errorCount, warningCount };

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    const jsonText = `${JSON.stringify(result, null, JSON_INDENT_SPACES)}\n`;
    io.write(jsonText);
    if (savePath !== undefined) {
      await mkdir(dirname(savePath), { recursive: true });
      await writeFile(savePath, jsonText, 'utf8');
      io.write(`Saved: ${savePath}\n`);
    }
  } else {
    renderPretty(cliVersion, result, io);
  }

  return ok ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
}
