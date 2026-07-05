import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagDefinition,
  type IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import { scanWorkspaceCatalog } from '@robota-sdk/dag-framework';
import { parseDagMd, DAG_MD_SUFFIX } from '../dag-md-parser/parse-dag-md.js';

export interface ICatalogMeta {
  readonly description?: string;
  readonly displayName?: string;
  readonly tags?: readonly string[];
}

export interface ICatalogEntry {
  readonly id: string;
  readonly filePath: string;
  readonly definition: IDagDefinition;
  readonly meta: ICatalogMeta;
}

// FLOW-007: JSON workflow definitions are read by the shared `scanWorkspaceCatalog`; only the
// `.dag.md` id-stripping remains here for the markdown format.
export const DEFAULT_CATALOG_DIR = DEFAULT_WORKSPACE_LAYOUT.root; // '.workflows'
export const GLOBAL_CATALOG_DIR = join(homedir(), DEFAULT_WORKSPACE_LAYOUT.root);

function extractId(fileName: string): string {
  return fileName.endsWith(DAG_MD_SUFFIX) ? fileName.slice(0, -DAG_MD_SUFFIX.length) : fileName;
}

/** Scan a directory for workflow definitions (shared JSON reader + `.dag.md`). */
export async function scanCatalogDir(
  dir: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICatalogEntry[]> {
  // FLOW-007 C3: JSON workflow definitions come from the shared workspace-catalog reader (one reader
  // for all consumers). dag-cli additionally supports the `.dag.md` markdown workflow format, layered
  // on top here.
  const jsonEntries: ICatalogEntry[] = await scanWorkspaceCatalog(dir, layout);

  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch {
    // allow-fallback: missing or unreadable dir → only whatever the shared reader found (empty)
    return jsonEntries;
  }

  const mdEntries: ICatalogEntry[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(DAG_MD_SUFFIX)) continue;
    const filePath = join(dir, fileName);
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      // allow-fallback: unreadable file is silently skipped
      continue;
    }
    const parseResult = parseDagMd(text);
    if (!parseResult.ok) continue;
    mdEntries.push({
      id: extractId(fileName),
      filePath,
      definition: parseResult.definition,
      meta: parseResult.meta,
    });
  }

  return [...jsonEntries, ...mdEntries].sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolve which catalog directories to scan based on flags. */
export function resolveCatalogDirs(opts: {
  readonly catalogDir?: string;
  readonly global?: boolean;
  readonly all?: boolean;
}): string[] {
  if (opts.all) {
    return [opts.catalogDir ?? DEFAULT_CATALOG_DIR, GLOBAL_CATALOG_DIR];
  }
  if (opts.global) {
    return [GLOBAL_CATALOG_DIR];
  }
  return [opts.catalogDir ?? DEFAULT_CATALOG_DIR];
}

/** Returns true if entry matches a search query (id, description, displayName, tags). */
export function matchesCatalogQuery(entry: ICatalogEntry, query: string): boolean {
  const lower = query.toLowerCase();
  if (entry.id.toLowerCase().includes(lower)) return true;
  if (entry.meta.description?.toLowerCase().includes(lower) === true) return true;
  if (entry.meta.displayName?.toLowerCase().includes(lower) === true) return true;
  if (entry.meta.tags?.some((t) => t.toLowerCase().includes(lower)) === true) return true;
  return false;
}
