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
  /** Extracted "Compact Instructions" section from CLAUDE.md, if present */
  compactInstructions?: string;
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
 * Extract the "Compact Instructions" section from CLAUDE.md content.
 * Looks for a markdown heading (any level) containing "Compact Instructions"
 * and returns all content until the next heading of the same or higher level.
 */
function extractCompactInstructions(content: string): string | undefined {
  const lines = content.split('\n');
  let capturing = false;
  let headingLevel = 0;
  const captured: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+/.exec(line);
    if (headingMatch) {
      if (capturing) {
        // Stop if we hit a heading of same or higher level
        if (headingMatch[1].length <= headingLevel) break;
      }
      if (/compact\s+instructions/i.test(line)) {
        capturing = true;
        headingLevel = headingMatch[1].length;
        continue;
      }
    }
    if (capturing) {
      captured.push(line);
    }
  }

  const result = captured.join('\n').trim();
  return result || undefined;
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

  const compactInstructions = extractCompactInstructions(claudeMd);

  return { agentsMd, claudeMd, compactInstructions };
}
