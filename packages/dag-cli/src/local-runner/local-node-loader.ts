import { readdir, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  IDagNodeDefinition,
  IDagError,
  INodeManifest,
  TPortPayload,
} from '@robota-sdk/dag-core';

// NODEDX-004: simple node format — export const node = { nodeType, execute, ...ports }
interface ISimpleNodeExport {
  readonly nodeType: string;
  readonly displayName?: string;
  readonly category?: string;
  readonly defaultInputPort?: string;
  readonly defaultOutputPort?: string;
  readonly inputs?: INodeManifest['inputs'];
  readonly outputs?: INodeManifest['outputs'];
  readonly configSchemaDefinition?: unknown;
  execute(
    input: Record<string, unknown>,
    context?: unknown,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
}

function isSimpleNodeExport(v: unknown): v is ISimpleNodeExport {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).nodeType === 'string' &&
    typeof (v as Record<string, unknown>).execute === 'function'
  );
}

function adaptSimpleNode(def: ISimpleNodeExport): IDagNodeDefinition {
  return {
    nodeType: def.nodeType,
    displayName: def.displayName ?? def.nodeType,
    category: def.category ?? 'Custom',
    defaultInputPort: def.defaultInputPort,
    defaultOutputPort: def.defaultOutputPort,
    inputs: def.inputs ?? [],
    outputs: def.outputs ?? [],
    configSchemaDefinition: def.configSchemaDefinition ?? null,
    taskHandler: {
      execute: (input, context) =>
        Promise.resolve(def.execute(input as Record<string, unknown>, context))
          .then((result) => ({ ok: true as const, value: result as TPortPayload }))
          .catch((err: unknown): { ok: false; error: IDagError } => ({
            ok: false as const,
            error: {
              code: 'NODE_EXECUTE_ERROR',
              category: 'task_execution',
              message: err instanceof Error ? err.message : String(err),
              retryable: false,
            },
          })),
    },
  };
}

export interface LocalNodeLoaderOptions {
  projectDir: string;
  verbose?: boolean;
}

const NODE_FILE_SUFFIXES = ['.dag.node.js', '.dag.node.cjs', '.dag.node.mjs'];
const TS_NODE_FILE_SUFFIX = '.dag.node.ts';
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.dag']);

function isNodeFile(name: string): boolean {
  return NODE_FILE_SUFFIXES.some((s) => name.endsWith(s)) || name.endsWith(TS_NODE_FILE_SUFFIX);
}

async function scanDirectory(dir: string, results: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // allow-fallback: unreadable directory is silently skipped
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry);
      let stats;
      try {
        stats = await stat(fullPath);
      } catch {
        // allow-fallback: inaccessible entry is skipped
        return;
      }
      if (stats.isDirectory()) {
        if (!IGNORED_DIRS.has(entry)) {
          await scanDirectory(fullPath, results);
        }
      } else if (stats.isFile() && isNodeFile(entry)) {
        results.push(fullPath);
      }
    }),
  );
}

async function tryLoadNodeFile(
  filePath: string,
  verbose: boolean,
): Promise<IDagNodeDefinition | null> {
  const ext = extname(filePath);
  if (ext === '.ts') {
    if (verbose) {
      process.stderr.write(
        `[local-node-loader] skip ${filePath}: TypeScript files require tsx.\n` +
          `  Compile to JS first (tsc) or run via: npx tsx dag run ...\n`,
      );
    }
    return null;
  }

  try {
    // allow-fallback: per-file load failure is non-fatal; other nodes still load
    // eslint-disable-next-line no-restricted-syntax -- runtime-discovered local node file; path unknown at compile time
    const module = await import(pathToFileURL(filePath).href);

    // NODEDX-004: simple `export const node = { nodeType, execute }` format takes priority
    if (module.node !== undefined) {
      if (isSimpleNodeExport(module.node)) return adaptSimpleNode(module.node);
      // AGENTUX-002: always warn — this is the most common LLM editing mistake
      process.stderr.write(
        `[dag] Warning: ${filePath} — 'node' export is missing nodeType or execute. Skipped.\n` +
          `  Hint: run \`dag node scaffold --dry-run <name>\` to see the expected shape.\n`,
      );
      return null;
    }

    const NodeClass: unknown = module.default;

    if (typeof NodeClass !== 'function') {
      if (verbose) {
        process.stderr.write(
          `[local-node-loader] skip ${filePath}: default export is not a constructor\n`,
        );
      }
      return null;
    }

    const instance = new (NodeClass as new () => unknown)() as IDagNodeDefinition;
    if (
      typeof instance !== 'object' ||
      instance === null ||
      typeof (instance as { nodeType?: unknown }).nodeType !== 'string'
    ) {
      if (verbose) {
        process.stderr.write(
          `[local-node-loader] skip ${filePath}: instance has no nodeType string\n`,
        );
      }
      return null;
    }

    return instance;
  } catch (err) {
    // allow-fallback: per-file load failure is non-fatal; other nodes still load
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[local-node-loader] failed to load ${filePath}: ${message}\n`);
    return null;
  }
}

/**
 * Loads a single node file explicitly. Throws if the file is not found,
 * cannot be loaded, or does not export a valid node definition.
 * Use this for `--node-file` flag processing where failure must be fatal.
 */
export async function loadNodeFileExplicit(filePath: string): Promise<IDagNodeDefinition> {
  let fileExists = false;
  try {
    // allow-fallback: catching stat error to give a clearer "file not found" message
    await stat(filePath);
    fileExists = true;
  } catch {
    fileExists = false;
  }
  if (!fileExists) {
    throw new Error(`--node-file path not found: ${filePath}`);
  }

  const ext = extname(filePath);
  if (ext === '.ts') {
    throw new Error(
      `--node-file ${filePath}: TypeScript files require tsx. Compile to JS first (tsc) or run via: npx tsx dag run ...`,
    );
  }

  // eslint-disable-next-line no-restricted-syntax -- explicit path from --node-file flag; runtime-only
  const module = await import(pathToFileURL(filePath).href);

  // NODEDX-004: simple `export const node = { nodeType, execute }` format takes priority
  if (module.node !== undefined) {
    if (!isSimpleNodeExport(module.node)) {
      throw new Error(
        `--node-file ${filePath}: 'node' export is missing nodeType string or execute function`,
      );
    }
    return adaptSimpleNode(module.node);
  }

  const NodeClass: unknown = module.default;

  if (typeof NodeClass !== 'function') {
    throw new Error(`--node-file ${filePath}: default export is not a constructor`);
  }

  const instance = new (NodeClass as new () => unknown)() as IDagNodeDefinition;
  if (
    typeof instance !== 'object' ||
    instance === null ||
    typeof (instance as { nodeType?: unknown }).nodeType !== 'string'
  ) {
    throw new Error(`--node-file ${filePath}: loaded instance has no nodeType string`);
  }

  return instance;
}

export async function loadLocalNodeDefinitions(
  options: LocalNodeLoaderOptions,
): Promise<IDagNodeDefinition[]> {
  const { projectDir, verbose = false } = options;
  const absoluteDir = resolve(projectDir);

  const filePaths: string[] = [];
  await scanDirectory(absoluteDir, filePaths);

  if (filePaths.length === 0) return [];

  if (verbose) {
    process.stderr.write(
      `[local-node-loader] found ${filePaths.length} candidate file(s) in ${absoluteDir}\n`,
    );
  }

  const results = await Promise.all(filePaths.map((fp) => tryLoadNodeFile(fp, verbose)));
  return results.filter((d): d is IDagNodeDefinition => d !== null);
}
