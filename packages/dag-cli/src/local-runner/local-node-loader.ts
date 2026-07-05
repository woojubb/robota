import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_WORKSPACE_LAYOUT } from '@robota-sdk/dag-core';
import type { IDagNodeDefinition, IWorkspaceLayout } from '@robota-sdk/dag-core';
import { adaptSimpleNode, isSimpleNodeExport, loadCodeNodesFromDir } from './code-node-adapter.js';
import { nodesDir } from './persistence/paths.js';

export interface LocalNodeLoaderOptions {
  projectDir: string;
  verbose?: boolean;
  /** FLOW-007: injected workspace layout (default `.workflows/`). */
  workspace?: IWorkspaceLayout;
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

/**
 * Discover local code nodes from the project's `.dag/nodes/` directory (DATA-002 P2). Each code node
 * is a `.node.json` manifest (metadata) plus a companion `.dag.node.js` (behavior). Replaces the
 * former whole-project scatter-scan; `--node-file` remains the explicit escape hatch.
 */
export async function loadLocalNodeDefinitions(
  options: LocalNodeLoaderOptions,
): Promise<IDagNodeDefinition[]> {
  const { projectDir, verbose = false, workspace = DEFAULT_WORKSPACE_LAYOUT } = options;
  const dir = nodesDir(projectDir, workspace);
  const results = await loadCodeNodesFromDir(dir);
  if (verbose) {
    process.stderr.write(`[local-node-loader] loaded ${results.length} code node(s) from ${dir}\n`);
  }
  return results;
}
