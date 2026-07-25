/**
 * The `Grep` tool's search internals — file enumeration and per-file matching.
 *
 * Split out of `grep-tool.ts` (SEC-007) when adding containment pushed that file past the
 * anti-monolith limit. The split is by responsibility, not by line count: this module is HOW the
 * search is performed, while `grep-tool.ts` is the tool SURFACE — schema, model-facing description,
 * factory, and the result envelope. Neither half needs to know the other's concerns.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { isWithinCwd } from './path-guard.js';

/** Convert a simple glob to a RegExp for file name filtering. */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/** Check if a file name matches an optional glob filter. */
function matchesGlob(filename: string, glob: string | undefined): boolean {
  if (glob === undefined) return true;
  return globToRegex(glob).test(filename);
}

/**
 * Gather all files under a directory recursively, excluding node_modules/.git.
 *
 * `containmentRoot` (SEC-007) drops any entry whose CANONICAL path escapes the root, before it is
 * descended into or read. `stat` follows symlinks, so without this a link inside the root pointing
 * out of it made the whole target tree readable — including, for a symlinked FILE, its contents.
 */
export async function collectFiles(
  dirPath: string,
  glob: string | undefined,
  containmentRoot: string | undefined,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entryNames: string[];
    try {
      entryNames = await readdir(current);
    } catch {
      return;
    }

    for (const name of entryNames) {
      if (name === 'node_modules' || name === '.git') continue;

      const fullPath = join(current, name);
      if (!isWithinCwd(fullPath, containmentRoot)) continue;
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(fullPath);
      } catch {
        continue;
      }

      if (fileStat.isDirectory()) {
        await walk(fullPath);
      } else if (fileStat.isFile()) {
        if (matchesGlob(name, glob)) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(dirPath);
  return results;
}

/** Search a single file for lines matching the regex. */
export function searchFile(
  content: string,
  filePath: string,
  regex: RegExp,
  contextLines: number,
  outputMode: 'files_with_matches' | 'content' | 'count',
): string[] {
  const lines = content.split('\n');
  const matchingIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      matchingIndices.push(i);
    }
  }

  if (matchingIndices.length === 0) return [];

  if (outputMode === 'files_with_matches') {
    return [filePath];
  }

  if (outputMode === 'count') {
    return [`${filePath}:${matchingIndices.length}`];
  }

  // content mode — include context lines
  const includedIndices = new Set<number>();
  for (const idx of matchingIndices) {
    for (
      let c = Math.max(0, idx - contextLines);
      c <= Math.min(lines.length - 1, idx + contextLines);
      c++
    ) {
      includedIndices.add(c);
    }
  }

  const outputLines: string[] = [];
  const sortedIndices = Array.from(includedIndices).sort((a, b) => a - b);

  let prevIdx: number | undefined;
  for (const idx of sortedIndices) {
    if (prevIdx !== undefined && idx > prevIdx + 1) {
      outputLines.push('--');
    }
    const lineNum = idx + 1;
    const marker = matchingIndices.includes(idx) ? ':' : '-';
    outputLines.push(`${filePath}:${lineNum}${marker}${lines[idx]}`);
    prevIdx = idx;
  }

  return outputLines;
}
