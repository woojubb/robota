/**
 * Context loader — walks up the directory tree from `cwd` collecting
 * AGENTS.md and CLAUDE.md files, then concatenates them root-first
 * so that more-specific (closer) instructions appear last.
 */
import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';

export interface ILoadedContext {
  /** Concatenated content of all AGENTS.md files found (root-first) */
  agentsMd: string;
  /** Concatenated content of all CLAUDE.md files found (root-first) */
  claudeMd: string;
}

const AGENTS_FILENAME = 'AGENTS.md';
const CLAUDE_FILENAME = 'CLAUDE.md';

/**
 * Walk up directory tree from `startDir`, collecting absolute paths of
 * files named `filename`. Stops at filesystem root.
 * Returns paths ordered root-first (farthest ancestor first).
 */
function collectFilesWalkingUp(startDir: string, filename: string): string[] {
  const found: string[] = [];
  let current = resolve(startDir);

  let atRoot = false;
  while (!atRoot) {
    const candidate = join(current, filename);
    if (existsSync(candidate)) {
      found.push(candidate);
    }
    const parent = dirname(current);
    atRoot = parent === current;
    if (!atRoot) {
      current = parent;
    }
  }

  // Reverse so that root (farthest) comes first
  return found.reverse();
}

/**
 * Load all AGENTS.md and CLAUDE.md files found by walking up from `cwd`.
 * Files from higher directories appear before files from lower directories.
 *
 * @param cwd - Starting directory for the walk-up search
 */
export async function loadContext(cwd: string): Promise<ILoadedContext> {
  const agentsPaths = collectFilesWalkingUp(cwd, AGENTS_FILENAME);
  const claudePaths = collectFilesWalkingUp(cwd, CLAUDE_FILENAME);

  const agentsMd = agentsPaths.map((p) => readFileSync(p, 'utf-8')).join('\n\n');

  const claudeMd = claudePaths.map((p) => readFileSync(p, 'utf-8')).join('\n\n');

  return { agentsMd, claudeMd };
}
