/**
 * Shared workspace-catalog reader (FLOW-007 C3).
 *
 * The single owner of "list the workflow definitions in a workspace directory" — unifying the three
 * previously-separate scanners (the persistence store's `loadWorkflows`, the dag-cli `catalog-scanner`,
 * and the `/workflows catalog` inline scan). Workflow definitions live **flat** under the workspace
 * root as `<name><workflowExt>`; node manifests (`.node.json`, which also end in `.json`) and non-DAG
 * JSON that share the root are skipped. The workspace layout is injected (default `.workflows/`).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagDefinition,
  type IWorkspaceLayout,
} from '@robota-sdk/dag-core';

/** Catalog metadata surfaced from a workflow definition's optional `meta` block. */
export interface IWorkspaceCatalogMeta {
  readonly description?: string;
  readonly displayName?: string;
  readonly tags?: readonly string[];
}

/** One workflow definition discovered in a workspace. */
export interface IWorkspaceCatalogEntry {
  /** File stem (the workflow id / name), e.g. `greet` for `greet.json`. */
  readonly id: string;
  /** Absolute path to the definition file. */
  readonly filePath: string;
  readonly definition: IDagDefinition;
  readonly meta: IWorkspaceCatalogMeta;
}

const NODE_MANIFEST_SUFFIX = '.node.json';

function extractMeta(raw: Record<string, unknown>): IWorkspaceCatalogMeta {
  const meta = raw['meta'];
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return {};
  const m = meta as Record<string, unknown>;
  return {
    description: typeof m['description'] === 'string' ? m['description'] : undefined,
    displayName: typeof m['displayName'] === 'string' ? m['displayName'] : undefined,
    tags: Array.isArray(m['tags'])
      ? (m['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : undefined,
  };
}

/** True when a parsed object looks like a DAG workflow (has `nodes` or a `dagId`). */
function isDagShaped(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw['nodes']) || typeof raw['dagId'] === 'string';
}

/**
 * Scan a directory for flat workflow definitions (`<name><workflowExt>`). Missing/unreadable dirs and
 * malformed / non-DAG / node-manifest files are skipped (never throws). Returns entries sorted by id.
 */
export async function scanWorkspaceCatalog(
  dir: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<IWorkspaceCatalogEntry[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch {
    // allow-fallback: a missing/unreadable workspace root is a normal empty catalog
    return [];
  }
  const ext = layout.workflowExt;
  const entries: IWorkspaceCatalogEntry[] = [];
  for (const fileName of fileNames) {
    if (fileName.endsWith(NODE_MANIFEST_SUFFIX) || !fileName.endsWith(ext)) continue;
    const filePath = join(dir, fileName);
    let raw: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      raw = parsed as Record<string, unknown>;
    } catch {
      // allow-fallback: unreadable/malformed file skipped
      continue;
    }
    if (!isDagShaped(raw)) continue; // aux JSON (aliases/history/…) sharing the root
    entries.push({
      id: fileName.slice(0, -ext.length),
      filePath,
      definition: raw as unknown as IDagDefinition,
      meta: extractMeta(raw),
    });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
