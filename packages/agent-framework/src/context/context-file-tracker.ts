import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/** A single context file entry tracked with its content hash. */
export interface IContextFileEntry {
  /** Absolute path to the file. */
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

/** Read a file from disk and return an entry with its content hash. */
export function loadFileWithHash(filePath: string): IContextFileEntry {
  const content = readFileSync(filePath, 'utf-8');
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
): Promise<IContextStalenessCheckResult> {
  const stale: IContextFileEntry[] = [];
  const fresh: IContextFileEntry[] = [];

  for (const entry of entries) {
    if (!existsSync(entry.filePath)) {
      fresh.push(entry);
      continue;
    }
    const diskContent = readFileSync(entry.filePath, 'utf-8');
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
): Promise<IContextRefreshResult> {
  const { stale } = await checkContextStaleness(entries);
  const staleSet = new Set(stale.map((e) => e.filePath));
  const refreshed: string[] = [];

  const updated = entries.map((entry) => {
    if (!staleSet.has(entry.filePath)) return entry;
    const diskContent = readFileSync(entry.filePath, 'utf-8');
    refreshed.push(entry.filePath);
    return {
      filePath: entry.filePath,
      content: diskContent,
      contentHash: computeContentHash(diskContent),
    };
  });

  return { updated, refreshed };
}
