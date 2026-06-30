import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IDagDefinition } from '@robota-sdk/dag-core';
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

const DAG_FILE_SUFFIX = '.dag.json';

export const DEFAULT_CATALOG_DIR = '.dag/workflows';
export const GLOBAL_CATALOG_DIR = join(homedir(), '.dag', 'workflows');

function extractId(fileName: string): string {
  if (fileName.endsWith(DAG_MD_SUFFIX)) return fileName.slice(0, -DAG_MD_SUFFIX.length);
  return fileName.endsWith(DAG_FILE_SUFFIX) ? fileName.slice(0, -DAG_FILE_SUFFIX.length) : fileName;
}

function extractMeta(raw: Record<string, unknown>): ICatalogMeta {
  const meta = raw['meta'];
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    return {};
  }
  const m = meta as Record<string, unknown>;
  return {
    description: typeof m['description'] === 'string' ? m['description'] : undefined,
    displayName: typeof m['displayName'] === 'string' ? m['displayName'] : undefined,
    tags: Array.isArray(m['tags'])
      ? (m['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : undefined,
  };
}

/** Scan a directory for `.dag.json` files and return parsed catalog entries. */
export async function scanCatalogDir(dir: string): Promise<ICatalogEntry[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch {
    // allow-fallback: missing or unreadable dir is treated as empty catalog
    return [];
  }

  const entries: ICatalogEntry[] = [];
  for (const fileName of fileNames) {
    const isDagJson = fileName.endsWith(DAG_FILE_SUFFIX);
    const isDagMd = fileName.endsWith(DAG_MD_SUFFIX);
    if (!isDagJson && !isDagMd) continue;

    const filePath = join(dir, fileName);
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      // allow-fallback: unreadable file is silently skipped
      continue;
    }

    if (isDagMd) {
      const parseResult = parseDagMd(text);
      if (!parseResult.ok) continue;
      entries.push({
        id: extractId(fileName),
        filePath,
        definition: parseResult.definition,
        meta: parseResult.meta,
      });
      continue;
    }

    let raw: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      raw = parsed as Record<string, unknown>;
    } catch {
      // allow-fallback: malformed JSON file is silently skipped
      continue;
    }

    entries.push({
      id: extractId(fileName),
      filePath,
      definition: raw as unknown as IDagDefinition,
      meta: extractMeta(raw),
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
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
