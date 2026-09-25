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

/**
 * Collapse `.` and `..` lexically, keeping a leading `..` of a relative path. Without this a path
 * like `.robota/worktrees/../settings.json` reads as a worktree file while naming the settings file.
 */
function resolvedSegments(path: string): string[] {
  const out: string[] = [];
  for (const segment of pathSegments(path)) {
    if (segment !== '..') out.push(segment);
    else if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else out.push(segment);
  }
  return out;
}

/** Whether a path names a protected directory, something inside one, or a protected file. */
export function isProtectedPath(path: string): boolean {
  const segments = resolvedSegments(path);
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

/** `~`, `$HOME` or `${HOME}`, then the rest of the path (possibly empty). */
const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)(.*)$/;

function isCriticalTarget(word: string, context: ICriticalPathContext): boolean {
  const text = unquoteWord(word);
  const home = HOME_PREFIX.exec(text);
  let absolute: string;
  if (home !== null) {
    const rest = home[1] ?? '';
    if (context.homeDirectory === undefined) return rest.replace(/\/+/g, '') === '';
    absolute = normaliseAbsolute(`${context.homeDirectory}/${rest}`);
  } else if (text === '' || text.startsWith('$')) {
    return false;
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
/**
 * Wrappers that run the command after them unchanged, and which of their options take a value
 * (so the value is not mistaken for the program).
 */
const TRANSPARENT_WRAPPERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['sudo', new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T'])],
  ['nice', new Set(['-n'])],
  ['env', new Set(['-u', '-C', '-S'])],
  ['command', new Set<string>()],
  ['builtin', new Set<string>()],
  ['nohup', new Set<string>()],
  ['time', new Set<string>()],
]);

/** Index of the program a segment runs, past assignments, wrappers and the wrappers' options. */
function programIndex(words: readonly string[]): number {
  let index = 0;
  let valueOptions: ReadonlySet<string> | undefined;
  while (index < words.length) {
    const word = words[index]!;
    if (/^[A-Za-z_]\w*=/.test(word)) {
      index += 1;
      continue;
    }
    const wrapper = TRANSPARENT_WRAPPERS.get(word);
    if (wrapper !== undefined) {
      valueOptions = wrapper;
      index += 1;
      continue;
    }
    if (valueOptions !== undefined && word.startsWith('-')) {
      index += valueOptions.has(word) ? 2 : 1;
      continue;
    }
    return index;
  }
  return index;
}

/**
 * Whether a shell line removes a critical path in any of the commands it runs. The line is cut the
 * way the deny direction cuts it, so a removal cannot hide behind an unrelated command before it.
 */
export function removesCriticalPath(command: string, context: ICriticalPathContext): boolean {
  return splitCommandSegments(command).some((segment) => {
    const words = segment.split(/\s+/).filter((word) => word !== '');
    const index = programIndex(words);
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
