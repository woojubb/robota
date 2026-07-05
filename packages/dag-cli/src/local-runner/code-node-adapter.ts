/**
 * Code-node adapter (DATA-002 P2 / NODEDX-004).
 *
 * Shared, dependency-free helpers for turning authored JS behavior into an `IDagNodeDefinition`.
 * Used by both the persistence store (manifest `kind:'code'` → metadata from the `.node.json`, behavior
 * from the companion `.dag.node.js`) and the local-node loader (standalone `export const node` format).
 * Kept in its own module so the store and loader can share it without an import cycle.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  IDagError,
  IDagNodeDefinition,
  INodeManifest,
  TPortPayload,
} from '@robota-sdk/dag-core';
import { NODE_MANIFEST_EXT } from './persistence/paths.js';

/** The standalone `export const node = { nodeType, execute, ...ports }` shape (NODEDX-004). */
export interface ISimpleNodeExport {
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

export function isSimpleNodeExport(v: unknown): v is ISimpleNodeExport {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).nodeType === 'string' &&
    typeof (v as Record<string, unknown>).execute === 'function'
  );
}

/** Execute signature for a code node's behavior. */
export type TCodeNodeExecute = ISimpleNodeExport['execute'];

/** Metadata + behavior needed to build a code-node definition (from an export OR a manifest). */
export interface ICodeNodeParts {
  readonly nodeType: string;
  readonly displayName?: string;
  readonly category?: string;
  readonly defaultInputPort?: string;
  readonly defaultOutputPort?: string;
  readonly inputs?: INodeManifest['inputs'];
  readonly outputs?: INodeManifest['outputs'];
  readonly configSchemaDefinition?: unknown;
  readonly execute: TCodeNodeExecute;
}

/** Build a runnable `IDagNodeDefinition` from metadata + an `execute` behavior. */
function buildCodeNodeDefinition(parts: ICodeNodeParts): IDagNodeDefinition {
  return {
    nodeType: parts.nodeType,
    displayName: parts.displayName ?? parts.nodeType,
    category: parts.category ?? 'Custom',
    defaultInputPort: parts.defaultInputPort,
    defaultOutputPort: parts.defaultOutputPort,
    inputs: parts.inputs ?? [],
    outputs: parts.outputs ?? [],
    configSchemaDefinition: parts.configSchemaDefinition ?? null,
    taskHandler: {
      execute: (input, context) =>
        Promise.resolve(parts.execute(input as Record<string, unknown>, context))
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

/** Adapt a standalone `export const node = {...}` (metadata + behavior in one object). */
export function adaptSimpleNode(def: ISimpleNodeExport): IDagNodeDefinition {
  return buildCodeNodeDefinition(def);
}

/** Dynamically import a runtime-discovered node file (path unknown at compile time). */
async function importNodeModule(filePath: string): Promise<Record<string, unknown>> {
  // eslint-disable-next-line no-restricted-syntax -- runtime-discovered local node file; path unknown at compile time
  return (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
}

/**
 * Extract just the `execute` behavior from a companion `.dag.node.js` module for the manifest-split
 * model. Metadata is NOT read here — it comes from the `.node.json` manifest (metadata SSOT).
 * Accepts `export const node = { execute }` or a bare `export function execute`.
 */
function extractCodeExecute(module: Record<string, unknown>): TCodeNodeExecute | null {
  const node = module['node'];
  if (typeof node === 'object' && node !== null) {
    const exec = (node as Record<string, unknown>)['execute'];
    if (typeof exec === 'function') return exec as TCodeNodeExecute;
  }
  const bare = module['execute'];
  return typeof bare === 'function' ? (bare as TCodeNodeExecute) : null;
}

/**
 * On-disk `kind:'code'` node manifest (metadata SSOT). Behavior lives in the `codeFile` companion.
 */
export interface IPersistedCodeManifest {
  readonly kind: 'code';
  readonly nodeType: string;
  readonly displayName?: string;
  readonly category?: string;
  readonly defaultInputPort?: string;
  readonly defaultOutputPort?: string;
  readonly inputs?: INodeManifest['inputs'];
  readonly outputs?: INodeManifest['outputs'];
  readonly configSchemaDefinition?: unknown;
  /** Filename (relative to `.dag/nodes/`) of the supplementary `.dag.node.js` behavior. */
  readonly codeFile: string;
}

/** Parse an on-disk record into a code manifest, or `null` if it is not a valid `kind:'code'` node. */
export function parseCodeManifest(raw: unknown): IPersistedCodeManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r['kind'] !== 'code') return null;
  if (typeof r['nodeType'] !== 'string' || typeof r['codeFile'] !== 'string') return null;
  return {
    kind: 'code',
    nodeType: r['nodeType'],
    codeFile: r['codeFile'],
    ...(typeof r['displayName'] === 'string' ? { displayName: r['displayName'] } : {}),
    ...(typeof r['category'] === 'string' ? { category: r['category'] } : {}),
    ...(typeof r['defaultInputPort'] === 'string'
      ? { defaultInputPort: r['defaultInputPort'] }
      : {}),
    ...(typeof r['defaultOutputPort'] === 'string'
      ? { defaultOutputPort: r['defaultOutputPort'] }
      : {}),
    ...(Array.isArray(r['inputs']) ? { inputs: r['inputs'] as INodeManifest['inputs'] } : {}),
    ...(Array.isArray(r['outputs']) ? { outputs: r['outputs'] as INodeManifest['outputs'] } : {}),
    ...(r['configSchemaDefinition'] !== undefined
      ? { configSchemaDefinition: r['configSchemaDefinition'] }
      : {}),
  };
}

/**
 * Reconstruct a runnable code node from its manifest (metadata SSOT) + the companion `.dag.node.js`
 * (behavior only). `nodesDirPath` is the directory holding both. Returns `null` — with a stderr log —
 * when the companion is missing, unimportable, or exports no `execute` (adversarial pass (a)).
 * Metadata always comes from the manifest, never the companion (adversarial pass (b): manifest wins).
 */
export async function reconstructCodeNode(
  nodesDirPath: string,
  manifest: IPersistedCodeManifest,
): Promise<IDagNodeDefinition | null> {
  const companionPath = join(nodesDirPath, manifest.codeFile);
  let execute: TCodeNodeExecute | null;
  try {
    execute = extractCodeExecute(await importNodeModule(companionPath));
  } catch (err) {
    // allow-fallback: a missing/unimportable companion skips the node, not crashes the load
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[code-node] ${manifest.nodeType}: companion ${manifest.codeFile} failed to import (${message}). Skipped.\n`,
    );
    return null;
  }
  if (!execute) {
    process.stderr.write(
      `[code-node] ${manifest.nodeType}: companion ${manifest.codeFile} exports no execute(). Skipped.\n`,
    );
    return null;
  }
  return buildCodeNodeDefinition({
    nodeType: manifest.nodeType,
    execute,
    ...(manifest.displayName !== undefined ? { displayName: manifest.displayName } : {}),
    ...(manifest.category !== undefined ? { category: manifest.category } : {}),
    ...(manifest.defaultInputPort !== undefined
      ? { defaultInputPort: manifest.defaultInputPort }
      : {}),
    ...(manifest.defaultOutputPort !== undefined
      ? { defaultOutputPort: manifest.defaultOutputPort }
      : {}),
    ...(manifest.inputs !== undefined ? { inputs: manifest.inputs } : {}),
    ...(manifest.outputs !== undefined ? { outputs: manifest.outputs } : {}),
    ...(manifest.configSchemaDefinition !== undefined
      ? { configSchemaDefinition: manifest.configSchemaDefinition }
      : {}),
  });
}

/**
 * Discover code nodes under `.dag/nodes/`: for every `*.node.json` with `kind:'code'`, combine its
 * manifest metadata with the companion behavior. Non-code manifests and malformed files are skipped.
 */
export async function loadCodeNodesFromDir(nodesDirPath: string): Promise<IDagNodeDefinition[]> {
  let files: string[];
  try {
    files = await readdir(nodesDirPath);
  } catch {
    // allow-fallback: .dag/nodes/ may not exist yet
    return [];
  }
  const defs: IDagNodeDefinition[] = [];
  for (const file of files.filter((f) => f.endsWith(NODE_MANIFEST_EXT))) {
    let manifest: IPersistedCodeManifest | null;
    try {
      manifest = parseCodeManifest(JSON.parse(await readFile(join(nodesDirPath, file), 'utf-8')));
    } catch {
      // allow-fallback: unreadable/unparseable manifest is skipped
      continue;
    }
    if (!manifest) continue;
    if (defs.some((d) => d.nodeType === manifest.nodeType)) continue;
    const def = await reconstructCodeNode(nodesDirPath, manifest);
    if (def) defs.push(def);
  }
  return defs;
}
