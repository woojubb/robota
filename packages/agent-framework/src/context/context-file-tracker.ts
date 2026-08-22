import { createHash } from 'node:crypto';

import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

/** A single context file entry tracked with its content hash. */
export interface IContextFileEntry {
  /** Authority-scoped path; project entries are relative to their authenticated root. */
  filePath: string;
  /** Content as read at load time. */
  content: string;
  /** SHA-256 hex digest of `content`. */
  contentHash: string;
}

/** Compute a SHA-256 hex digest of the given string content. */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Read a project-relative file through an authorized reader and return its content hash. */
export function loadFileWithHash(
  filePath: string,
  reader: IWorkspaceProjectReader,
): IContextFileEntry {
  const content = assertWorkspaceProjectReader(reader).readText(filePath, 'load project context');
  if (content === undefined) throw new Error(`Project context file is missing: ${filePath}`);
  return { filePath, content, contentHash: computeContentHash(content) };
}

/** Result of a staleness check. */
export interface IContextStalenessCheckResult {
  stale: IContextFileEntry[];
  fresh: IContextFileEntry[];
}

/**
 * Compare stored content hashes against what is currently on disk.
 * Files that no longer exist on disk are treated as fresh (not changed).
 */
export async function checkContextStaleness(
  entries: readonly IContextFileEntry[],
  reader: IWorkspaceProjectReader,
): Promise<IContextStalenessCheckResult> {
  const stale: IContextFileEntry[] = [];
  const fresh: IContextFileEntry[] = [];

  for (const entry of entries) {
    const diskContent = assertWorkspaceProjectReader(reader).readText(
      entry.filePath,
      'check project context staleness',
    );
    if (diskContent === undefined) {
      fresh.push(entry);
      continue;
    }
    const diskHash = computeContentHash(diskContent);
    if (diskHash !== entry.contentHash) {
      stale.push(entry);
    } else {
      fresh.push(entry);
    }
  }

  return { stale, fresh };
}

/** Result of refreshing stale context entries. */
export interface IContextRefreshResult {
  /** All entries, with stale ones replaced by their re-read versions. */
  updated: IContextFileEntry[];
  /** File paths that were refreshed (had stale content). */
  refreshed: string[];
}

/**
 * Re-read any stale files from disk and return updated entries.
 * Fresh entries are returned unchanged.
 */
export async function refreshContextEntries(
  entries: readonly IContextFileEntry[],
  reader: IWorkspaceProjectReader,
): Promise<IContextRefreshResult> {
  const accepted = assertWorkspaceProjectReader(reader);
  const { stale } = await checkContextStaleness(entries, accepted);
  const staleSet = new Set(stale.map((e) => e.filePath));
  const refreshed: string[] = [];

  const updated = entries.map((entry) => {
    if (!staleSet.has(entry.filePath)) return entry;
    const diskContent = accepted.readText(entry.filePath, 'refresh project context');
    if (diskContent === undefined) return entry;
    refreshed.push(entry.filePath);
    return {
      filePath: entry.filePath,
      content: diskContent,
      contentHash: computeContentHash(diskContent),
    };
  });

  return { updated, refreshed };
}
