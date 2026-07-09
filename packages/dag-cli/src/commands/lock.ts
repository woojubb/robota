import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { access } from 'node:fs/promises';
import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';

const JSON_INDENT_SPACES = 2;
const DAG_LOCK_FILENAME = 'dag.lock';
const DAG_DIR = '.dag';

// LLM node types that carry a model config field
const LLM_NODE_TYPES = new Set(['llm-text']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ILockfileNodeEntry {
  readonly nodeType: string;
  readonly resolvedModel: string;
}

interface ILockfile {
  readonly lockfileVersion: number;
  readonly generatedAt: string;
  readonly nodes: Record<string, ILockfileNodeEntry>;
}

interface IDagNodeRaw {
  readonly nodeId?: string;
  readonly nodeType?: string;
  readonly config?: Record<string, unknown>;
}

interface IDagFileRaw {
  readonly nodes?: IDagNodeRaw[];
}

export interface ILockCommandOptions {
  readonly io: IDagCliIo;
  readonly cwd?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false, // allow-fallback: fs.access throws on not-found; false is the correct semantic
  );
}

function resolveLockfilePath(cwd: string): string {
  return join(cwd, DAG_DIR, DAG_LOCK_FILENAME);
}

async function readLockfile(cwd: string): Promise<ILockfile | null> {
  const lockPath = resolveLockfilePath(cwd);
  let text: string;
  try {
    text = await readFile(lockPath, 'utf8');
  } catch (_readErr) {
    // allow-fallback: missing lockfile returns null
    return null;
  }
  try {
    return JSON.parse(text) as ILockfile;
  } catch (_parseErr) {
    // allow-fallback: malformed lockfile returns null
    return null;
  }
}

async function writeLockfile(cwd: string, lockfile: ILockfile): Promise<void> {
  const lockPath = resolveLockfilePath(cwd);
  const dir = dirname(lockPath);
  await mkdir(dir, { recursive: true });
  await writeFile(lockPath, JSON.stringify(lockfile, null, JSON_INDENT_SPACES) + '\n', 'utf8');
}

/**
 * Scan a directory for `.dag.json` files and extract LLM node model entries.
 * Returns a map of nodeId -> ILockfileNodeEntry.
 */
async function scanDagFiles(
  dirPath: string,
  io: IDagCliIo,
): Promise<Record<string, ILockfileNodeEntry>> {
  const exists = await pathExists(dirPath);
  if (!exists) {
    return {};
  }

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (_readdirErr) {
    // allow-fallback: unreadable directory produces empty result
    return {};
  }

  const dagJsonFiles = entries.filter((f) => f.endsWith('.dag.json'));
  const nodes: Record<string, ILockfileNodeEntry> = {};

  for (const fileName of dagJsonFiles) {
    const fullPath = join(dirPath, fileName);
    let text: string;
    try {
      text = await io.readTextFile(fullPath);
    } catch (_readErr) {
      // allow-fallback: unreadable file is skipped
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (_parseErr) {
      // allow-fallback: invalid JSON is skipped
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      continue;
    }

    const dagFile = parsed as IDagFileRaw;
    const dagNodes = dagFile.nodes ?? [];

    for (const node of dagNodes) {
      if (
        typeof node.nodeId !== 'string' ||
        typeof node.nodeType !== 'string' ||
        !LLM_NODE_TYPES.has(node.nodeType)
      ) {
        continue;
      }

      const model = typeof node.config?.['model'] === 'string' ? node.config['model'] : 'unknown';

      nodes[node.nodeId] = {
        nodeType: node.nodeType,
        resolvedModel: model,
      };
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

/**
 * `dag lock generate <dir>`
 * Reads all `.dag.json` files in <dir>, extracts LLM node models, writes `.dag/dag.lock`.
 */
async function lockGenerate(
  args: readonly string[],
  options: ILockCommandOptions,
): Promise<number> {
  const { io, cwd = process.cwd() } = options;

  const positional = args.filter((a) => !a.startsWith('--'));
  const scanDir = positional[0] ?? join(cwd, DAG_DIR, 'workflows');

  const nodes = await scanDagFiles(scanDir, io);

  const lockfile: ILockfile = {
    lockfileVersion: 1,
    generatedAt: new Date().toISOString(),
    nodes,
  };

  try {
    await writeLockfile(cwd, lockfile);
  } catch (writeErr) {
    // allow-fallback: write errors are reported to the user as structured failure
    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
    io.write(`Error: Failed to write lockfile: ${msg}\n`);
    return FAILURE_EXIT_CODE;
  }

  const lockPath = resolveLockfilePath(cwd);
  const nodeCount = Object.keys(nodes).length;
  io.write(`✓ Generated ${lockPath}\n`);
  io.write(`  Locked ${nodeCount} LLM node${nodeCount === 1 ? '' : 's'}\n`);
  return SUCCESS_EXIT_CODE;
}

/**
 * `dag lock check`
 * Compares `.dag/dag.lock` against current `.dag/workflows/*.dag.json` files.
 */
async function lockCheck(_args: readonly string[], options: ILockCommandOptions): Promise<number> {
  const { io, cwd = process.cwd() } = options;

  const lockfile = await readLockfile(cwd);
  if (lockfile === null) {
    io.write(`Error: No lockfile found. Run 'dag lock generate' first.\n`);
    return FAILURE_EXIT_CODE;
  }

  const workflowsDir = join(cwd, DAG_DIR, 'workflows');
  const currentNodes = await scanDagFiles(workflowsDir, io);

  const mismatches: string[] = [];

  for (const [nodeId, locked] of Object.entries(lockfile.nodes)) {
    const current = currentNodes[nodeId];
    if (current === undefined) {
      mismatches.push(`  Node '${nodeId}': in lockfile but not found in current DAG files`);
      continue;
    }
    if (current.resolvedModel !== locked.resolvedModel) {
      mismatches.push(
        `  Node '${nodeId}': model changed from '${locked.resolvedModel}' to '${current.resolvedModel}'`,
      );
    }
  }

  for (const nodeId of Object.keys(currentNodes)) {
    if (!(nodeId in lockfile.nodes)) {
      const node = currentNodes[nodeId];
      if (node !== undefined) {
        mismatches.push(
          `  Node '${nodeId}': new LLM node (model: '${node.resolvedModel}') not in lockfile`,
        );
      }
    }
  }

  if (mismatches.length === 0) {
    io.write(`✓ Lockfile is up to date.\n`);
    return SUCCESS_EXIT_CODE;
  }

  io.write(`✗ Lockfile has ${mismatches.length} mismatch${mismatches.length === 1 ? '' : 'es'}:\n`);
  for (const mismatch of mismatches) {
    io.write(`${mismatch}\n`);
  }
  io.write(`\nRun 'dag lock update' to update the lockfile.\n`);
  return FAILURE_EXIT_CODE;
}

/**
 * `dag lock update`
 * Regenerates the lockfile from the current DAG files.
 */
async function lockUpdate(args: readonly string[], options: ILockCommandOptions): Promise<number> {
  const { cwd = process.cwd() } = options;
  const workflowsDir = join(cwd, DAG_DIR, 'workflows');
  return lockGenerate([workflowsDir, ...args.filter((a) => !a.startsWith('--'))], {
    ...options,
    cwd,
  });
}

/**
 * `dag lock diff`
 * Shows the diff between the lockfile and the current DAG files.
 */
async function lockDiff(_args: readonly string[], options: ILockCommandOptions): Promise<number> {
  const { io, cwd = process.cwd() } = options;

  const lockfile = await readLockfile(cwd);
  if (lockfile === null) {
    io.write(`Error: No lockfile found. Run 'dag lock generate' first.\n`);
    return FAILURE_EXIT_CODE;
  }

  const workflowsDir = join(cwd, DAG_DIR, 'workflows');
  const currentNodes = await scanDagFiles(workflowsDir, io);

  const removedIds = Object.keys(lockfile.nodes).filter((id) => !(id in currentNodes));
  const addedIds = Object.keys(currentNodes).filter((id) => !(id in lockfile.nodes));
  const changedIds = Object.keys(lockfile.nodes).filter((id) => {
    const current = currentNodes[id];
    const locked = lockfile.nodes[id];
    return (
      current !== undefined &&
      locked !== undefined &&
      current.resolvedModel !== locked.resolvedModel
    );
  });

  if (removedIds.length === 0 && addedIds.length === 0 && changedIds.length === 0) {
    io.write(`No differences — lockfile matches current DAG files.\n`);
    return SUCCESS_EXIT_CODE;
  }

  if (removedIds.length > 0) {
    io.write(`Removed nodes (in lockfile, not in DAG files):\n`);
    for (const id of removedIds) {
      const node = lockfile.nodes[id];
      if (node !== undefined) {
        io.write(`  - ${id} (${node.nodeType}, model: '${node.resolvedModel}')\n`);
      }
    }
  }

  if (addedIds.length > 0) {
    io.write(`Added nodes (in DAG files, not in lockfile):\n`);
    for (const id of addedIds) {
      const node = currentNodes[id];
      if (node !== undefined) {
        io.write(`  + ${id} (${node.nodeType}, model: '${node.resolvedModel}')\n`);
      }
    }
  }

  if (changedIds.length > 0) {
    io.write(`Changed nodes:\n`);
    for (const id of changedIds) {
      const locked = lockfile.nodes[id];
      const current = currentNodes[id];
      if (locked !== undefined && current !== undefined) {
        io.write(`  ~ ${id}: '${locked.resolvedModel}' -> '${current.resolvedModel}'\n`);
      }
    }
  }

  return SUCCESS_EXIT_CODE;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const LOCK_HELP_TEXT = `Usage: dag lock <subcommand> [options]

Manage workflow version lockfiles (.dag/dag.lock).

Subcommands:
  generate [dir]   Scan DAG files in <dir> and generate .dag/dag.lock
                   Default dir: .dag/workflows/
  check            Compare lockfile against current DAG files
  update           Regenerate the lockfile from current DAG files
  diff             Show differences between lockfile and current DAG files

Examples:
  dag lock generate .dag/workflows/
  dag lock check
  dag lock update
  dag lock diff
`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Execute the `dag lock` subcommand.
 *
 * @param args - The argv slice starting after the `lock` keyword.
 * @param options - IO abstraction and optional working directory.
 * @returns Exit code.
 */
export async function lockCommand(
  args: readonly string[],
  options: ILockCommandOptions,
): Promise<number> {
  const { io } = options;

  const subcommand = args[0];

  if (subcommand === '--help' || subcommand === '-h' || subcommand === undefined) {
    io.write(LOCK_HELP_TEXT);
    return SUCCESS_EXIT_CODE;
  }

  const remaining = args.slice(1);

  switch (subcommand) {
    case 'generate':
      return lockGenerate(remaining, options);
    case 'check':
      return lockCheck(remaining, options);
    case 'update':
      return lockUpdate(remaining, options);
    case 'diff':
      return lockDiff(remaining, options);
    default:
      io.write(`Error: Unknown lock subcommand '${subcommand}'. Run 'dag lock --help'.\n`);
      return USAGE_ERROR_EXIT_CODE;
  }
}

// ---------------------------------------------------------------------------
// Frozen-run validation (used by run.ts)
// ---------------------------------------------------------------------------

/**
 * Verify that a DAG definition's LLM node models match the lockfile.
 * Called by `dag run --frozen`.
 *
 * Returns null if validation passes, or an error message string if it fails.
 */
export async function validateFrozenRun(
  dagNodes: ReadonlyArray<IDagNodeRaw>,
  cwd: string,
): Promise<string | null> {
  const lockfile = await readLockfile(cwd);
  if (lockfile === null) {
    return `No lockfile found at ${resolveLockfilePath(cwd)}. Run 'dag lock generate' first.`;
  }

  for (const node of dagNodes) {
    if (
      typeof node.nodeId !== 'string' ||
      typeof node.nodeType !== 'string' ||
      !LLM_NODE_TYPES.has(node.nodeType)
    ) {
      continue;
    }

    const lockedEntry = lockfile.nodes[node.nodeId];
    if (lockedEntry === undefined) {
      // Node not in lockfile — skip (lock check will catch this separately)
      continue;
    }

    const currentModel =
      typeof node.config?.['model'] === 'string' ? node.config['model'] : 'unknown';

    if (currentModel !== lockedEntry.resolvedModel) {
      return (
        `Node '${node.nodeId}' uses model '${currentModel}' but dag.lock expects ` +
        `'${lockedEntry.resolvedModel}'. Run 'dag lock update' to update the lock.`
      );
    }
  }

  return null;
}
