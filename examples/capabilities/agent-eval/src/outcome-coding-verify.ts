import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  CODING_TASKS,
  serializeCodingTasks,
  taskFiles,
  type ICodingTask,
  type ICodingTaskDefinition,
} from './outcome-coding-tasks.js';

/** Where the verifier sees the tree it checks; its programs read this fixed path. */
export const VERIFIER_MOUNT = '/work';

/** Mode every protected file is created with and must still have after the trial. */
export const PROTECTED_FILE_MODE = '0644';

export interface IManifestEntry {
  readonly path: string;
  readonly sha256: string;
  /** Permission bits as a four-digit octal string, for example `0644`. */
  readonly mode: string;
}

/** The verifier's whole observation of one finished trial, as a plain JSON record. */
export interface ICodingObservation {
  readonly taskId: string;
  /** Verifier process exit code; null when it was killed or timed out. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Every protected file exists as a regular file with its original bytes. */
  readonly protectedFilesUnchanged: boolean;
  readonly changedProtectedFiles: readonly string[];
  /** No file other than the initial files and the allowed outputs exists. */
  readonly noUnexpectedFiles: boolean;
  readonly unexpectedFiles: readonly string[];
  /** No symlink or other non-regular entry, and no path resolving outside the root. */
  readonly noEscapes: boolean;
  readonly escapes: readonly string[];
  readonly manifest: readonly IManifestEntry[];
}

export interface IVerifierLimits {
  readonly memory: string;
  readonly cpus: string;
  readonly pids: number;
  readonly timeoutMs: number;
}

export const DEFAULT_VERIFIER_LIMITS: IVerifierLimits = {
  memory: '512m',
  cpus: '1',
  pids: 64,
  timeoutMs: 15_000,
};

export interface IContainerArgsInput {
  readonly name: string;
  readonly image: string;
  /** Absolute host directory holding the tree to verify. */
  readonly root: string;
  readonly task: Pick<ICodingTaskDefinition, 'verifier'>;
  readonly limits?: IVerifierLimits;
}

/**
 * Arguments after `docker` for the verifier container: read-only root filesystem and tree, no
 * network, no capabilities, non-root, bounded memory, CPU and processes. Pure data; the timeout
 * is enforced by the runner that spawns it.
 */
export function buildVerifierContainerArgs(input: IContainerArgsInput): string[] {
  const limits = input.limits ?? DEFAULT_VERIFIER_LIMITS;
  return [
    'run',
    '--rm',
    '--name',
    input.name,
    '--label',
    'robota.eval=coding-verifier',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '1000:1000',
    '--pids-limit',
    String(limits.pids),
    '--memory',
    limits.memory,
    '--memory-swap',
    limits.memory,
    '--cpus',
    limits.cpus,
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,noexec,size=16777216',
    '-v',
    `${input.root}:${VERIFIER_MOUNT}:ro`,
    '-w',
    VERIFIER_MOUNT,
    input.image,
    'node',
    '--input-type=module',
    '-e',
    input.task.verifier,
  ];
}

/** Writes a task tree (initial or solved control) into an existing directory. */
export function materializeTask(
  task: ICodingTaskDefinition,
  root: string,
  kind: 'broken' | 'solved',
): void {
  for (const [path, content] of Object.entries(taskFiles(task, kind))) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    chmodSync(dirname(target), 0o755);
    writeFileSync(target, content, { mode: 0o644 });
    chmodSync(target, 0o644);
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function walk(root: string, directory: string, found: string[]): void {
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry);
    const stat = lstatSync(absolute);
    const relativePath = relative(root, absolute).split(sep).join('/');
    if (stat.isDirectory()) {
      const before = found.length;
      walk(root, absolute, found);
      // A directory that holds nothing is itself an entry the task never created.
      if (found.length === before) found.push(`${relativePath}/`);
    } else found.push(relativePath);
  }
}

/**
 * Reads the finished tree without following links and builds the observation. Symlinks, special
 * files and anything resolving outside the root are recorded as escapes and never read.
 */
export function observeTree(
  task: ICodingTaskDefinition,
  root: string,
  run: { readonly exitCode: number | null; readonly timedOut?: boolean },
): ICodingObservation {
  const rootPath = resolve(root);
  const entries: string[] = [];
  walk(rootPath, rootPath, entries);

  const escapes: string[] = [];
  const regular: string[] = [];
  const manifest: IManifestEntry[] = [];
  const emptyDirectories: string[] = [];
  for (const path of entries) {
    if (path.endsWith('/')) {
      emptyDirectories.push(path);
      continue;
    }
    const absolute = join(rootPath, path);
    const stat = lstatSync(absolute);
    const rel = relative(rootPath, absolute);
    const inside = rel !== '..' && !rel.startsWith(`..${sep}`);
    if (!stat.isFile() || !inside) {
      escapes.push(path);
      continue;
    }
    regular.push(path);
    manifest.push({
      path,
      sha256: sha256(readFileSync(absolute)),
      mode: (stat.mode & 0o7777).toString(8).padStart(4, '0'),
    });
  }

  const known = new Set([...Object.keys(task.files), ...task.allowed]);
  const unexpectedFiles = [...regular.filter((path) => !known.has(path)), ...emptyDirectories];
  const protectedPaths = Object.keys(task.files).filter((path) => !task.allowed.includes(path));
  const changedProtectedFiles = protectedPaths.filter((path) => {
    const entry = manifest.find((candidate) => candidate.path === path);
    const original = sha256(Buffer.from(task.files[path] ?? '', 'utf8'));
    return entry === undefined || entry.sha256 !== original || entry.mode !== PROTECTED_FILE_MODE;
  });
  // A protected path that was replaced by a symlink is reported as changed as well.
  for (const path of escapes) {
    if (protectedPaths.includes(path) && !changedProtectedFiles.includes(path)) {
      changedProtectedFiles.push(path);
    }
  }

  return {
    taskId: task.id,
    exitCode: run.exitCode,
    timedOut: run.timedOut ?? false,
    protectedFilesUnchanged: changedProtectedFiles.length === 0,
    changedProtectedFiles,
    noUnexpectedFiles: unexpectedFiles.length === 0,
    unexpectedFiles,
    noEscapes: escapes.length === 0,
    escapes,
    manifest,
  };
}

/**
 * Persists an observation exactly once: the exclusive-create flag makes a second write for the
 * same path fail instead of replacing the first record.
 */
export function writeObservationOnce(path: string, observation: ICodingObservation): void {
  writeFileSync(path, `${JSON.stringify(observation, null, 2)}\n`, { flag: 'wx', mode: 0o444 });
}

export function readObservation(path: string): ICodingObservation {
  return JSON.parse(readFileSync(path, 'utf8')) as ICodingObservation;
}

/**
 * Trusted local runner for the exact broken and solved controls only. It refuses any task that
 * differs from the frozen definition, builds the tree itself and never accepts a directory, and
 * runs with a minimal environment (PATH and a temporary HOME), so model-written code cannot reach it.
 * The verifier program reads the tree at its fixed mount path, which is substituted with the
 * temporary directory for this host run.
 */
export function runTrustedControl(
  candidate: ICodingTask,
  kind: 'broken' | 'solved',
  timeoutMs = DEFAULT_VERIFIER_LIMITS.timeoutMs,
): ICodingObservation {
  const task = requireFrozenTask(candidate);
  const root = mkdtempSync(join(tmpdir(), 'coding-control-'));
  const home = mkdtempSync(join(tmpdir(), 'coding-control-home-'));
  try {
    materializeTask(task, root, kind);
    const code = task.verifier.replaceAll(`${VERIFIER_MOUNT}/`, `${root}/`);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: root,
      timeout: timeoutMs,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    return observeTree(task, root, {
      exitCode: result.status,
      timedOut:
        result.error !== undefined && 'code' in result.error && result.error.code === 'ETIMEDOUT',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Returns the frozen task with the candidate's id, refusing a candidate whose canonical
 * serialization differs from it in any field. Only frozen data can reach the host runner.
 */
export function requireFrozenTask(candidate: ICodingTask): ICodingTask {
  const frozen = CODING_TASKS.find((task) => task.id === candidate.id);
  if (
    frozen === undefined ||
    serializeCodingTasks([candidate]) !== serializeCodingTasks([frozen])
  ) {
    throw new Error(`Refusing to run a task that is not the frozen definition: ${candidate.id}`);
  }
  return frozen;
}

/**
 * Runs the verifier for a finished tree in the locked-down container and returns the observation.
 * The container is removed on timeout. Requires a local Docker daemon and an image with Node.
 */
export async function runContainerVerifier(
  task: ICodingTaskDefinition,
  root: string,
  options: { readonly image: string; readonly limits?: IVerifierLimits; readonly name?: string },
): Promise<ICodingObservation> {
  const limits = options.limits ?? DEFAULT_VERIFIER_LIMITS;
  const name =
    options.name ??
    `robota-eval-verifier-${createHash('sha256')
      .update(root + Date.now())
      .digest('hex')
      .slice(0, 12)}`;
  const args = buildVerifierContainerArgs({
    name,
    image: options.image,
    root: resolve(root),
    task,
    limits,
  });
  const outcome = await new Promise<{ exitCode: number | null; timedOut: boolean }>((done) => {
    const child = spawn('docker', args, { stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 10_000 });
      child.kill('SIGKILL');
    }, limits.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ exitCode: timedOut ? null : code, timedOut });
    });
    child.on('error', () => {
      clearTimeout(timer);
      done({ exitCode: null, timedOut });
    });
  });
  return observeTree(task, root, outcome);
}
