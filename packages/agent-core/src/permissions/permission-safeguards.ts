/**
 * The calls no rule and no mode may auto-approve (issue #3081, never-auto-approve set).
 *
 * Two families live here, both answered from the call's own arguments:
 *
 * - **critical-path removal** — a shell line that runs `rm`/`rmdir` against the filesystem root, a
 *   top-level directory, the home directory, or the working directory or one of its parents;
 * - **protected paths** — a modify-class call whose path argument lands in a directory or file that
 *   holds repository, agent or shell configuration, where a silent write widens what later turns,
 *   child sessions or the user's shell will trust.
 *
 * Pure string work — `agent-core` ships a browser bundle (CORE-028), so no Node builtin.
 */

import { splitCommandSegments } from './command-segments.js';

/** Directories whose contents configure the repository, the agent or its hooks. */
export const PROTECTED_DIRECTORY_NAMES: readonly string[] = ['.git', '.robota', '.claude', '.agents'];

/** Files that configure git, npm, MCP servers or the user's shell, wherever they sit. */
export const PROTECTED_FILE_NAMES: readonly string[] = [
  '.mcp.json',
  '.gitconfig',
  '.npmrc',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.profile',
];

/**
 * An isolated subagent's worktree lives under `.robota/worktrees/<name>` (and Claude Code's under
 * `.claude/worktrees`). Its files are ordinary workspace files; protection resumes for any protected
 * name inside the worktree.
 */
const WORKTREE_CONTAINER = 'worktrees';

function pathSegments(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

/** Whether a path names a protected directory, something inside one, or a protected file. */
export function isProtectedPath(path: string): boolean {
  const segments = pathSegments(path);
  const last = segments[segments.length - 1];
  if (last !== undefined && PROTECTED_FILE_NAMES.includes(last)) return true;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (!PROTECTED_DIRECTORY_NAMES.includes(segment)) continue;
    const isWorktreeEntry =
      (segment === '.robota' || segment === '.claude') &&
      segments[index + 1] === WORKTREE_CONTAINER &&
      segments[index + 2] !== undefined;
    if (isWorktreeEntry) {
      index += 2;
      continue;
    }
    return true;
  }
  return false;
}

/** Where a removal is judged from. Either may be unknown; what is unknown is not guessed. */
export interface ICriticalPathContext {
  /** The session's execution root. */
  cwd?: string;
  /** The user's home directory. */
  homeDirectory?: string;
}

function normaliseAbsolute(path: string): string {
  const out: string[] = [];
  for (const segment of pathSegments(path)) {
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return `/${out.join('/')}`;
}

function unquoteWord(word: string): string {
  return word.replace(/^(['"])(.*)\1$/, '$2');
}

const HOME_WORDS = new Set(['~', '~/', '$HOME', '${HOME}', '"$HOME"', '"${HOME}"']);

function isCriticalTarget(word: string, context: ICriticalPathContext): boolean {
  if (HOME_WORDS.has(word)) return true;
  const text = unquoteWord(word);
  if (text === '' || text.startsWith('$')) return false;
  let absolute: string;
  if (text.startsWith('~/')) {
    if (context.homeDirectory === undefined) return false;
    absolute = normaliseAbsolute(`${context.homeDirectory}/${text.slice(2)}`);
  } else if (text.startsWith('/')) {
    absolute = normaliseAbsolute(text);
  } else {
    if (context.cwd === undefined) return false;
    absolute = normaliseAbsolute(`${context.cwd}/${text}`);
  }
  // The root, and every top-level directory (`/usr`, `/home`, …).
  if (pathSegments(absolute).length <= 1) return true;
  if (
    context.homeDirectory !== undefined &&
    absolute === normaliseAbsolute(context.homeDirectory)
  ) {
    return true;
  }
  if (context.cwd !== undefined) {
    const cwd = normaliseAbsolute(context.cwd);
    // The working directory itself, or any of its parents.
    if (cwd === absolute || cwd.startsWith(`${absolute}/`)) return true;
  }
  return false;
}

const REMOVAL_COMMANDS = new Set(['rm', 'rmdir']);
/** Wrappers that run the command after them unchanged. */
const TRANSPARENT_WRAPPERS = new Set(['sudo', 'command', 'builtin', 'nice', 'nohup', 'time', 'env']);

/**
 * Whether a shell line removes a critical path in any of the commands it runs. The line is cut the
 * way the deny direction cuts it, so a removal cannot hide behind an unrelated command before it.
 */
export function removesCriticalPath(command: string, context: ICriticalPathContext): boolean {
  return splitCommandSegments(command).some((segment) => {
    const words = segment.split(/\s+/).filter((word) => word !== '');
    let index = 0;
    while (
      index < words.length &&
      (TRANSPARENT_WRAPPERS.has(words[index]!) || /^[A-Za-z_]\w*=/.test(words[index]!))
    ) {
      index += 1;
    }
    const program = words[index];
    if (program === undefined) return false;
    const name = program.slice(program.lastIndexOf('/') + 1);
    if (!REMOVAL_COMMANDS.has(name)) return false;
    let optionsEnded = false;
    return words.slice(index + 1).some((word) => {
      if (!optionsEnded && word === '--') {
        optionsEnded = true;
        return false;
      }
      if (!optionsEnded && word.startsWith('-')) return false;
      return isCriticalTarget(word, context);
    });
  });
}
