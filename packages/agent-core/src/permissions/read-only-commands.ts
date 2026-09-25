/**
 * The built-in read-only shell commands: a call that only looks is decided like a read, so it runs
 * without a prompt in every mode (issue #3082).
 *
 * The set is fixed, not configurable: a user who wants a prompt for one of these adds an `ask` or
 * `deny` rule, which the gate checks first. Every rule below fails toward "not read-only" — a line
 * this module cannot fully account for is an ordinary command and takes the ordinary path.
 *
 * No Node builtin: `agent-core` ships a browser bundle, and this is pure string work.
 */

import { splitCommandSegments } from './command-segments.js';

/** Past this length a line is not inspected at all. */
const MAX_INSPECTED_LENGTH = 10_000;

/** Commands that read and print and nothing else, whatever their arguments. */
const PLAIN_READERS = new Set([
  'ls',
  'cat',
  'echo',
  'pwd',
  'head',
  'tail',
  'grep',
  'wc',
  'which',
  'diff',
  'stat',
  'du',
  'cd',
]);

/** `find` predicates that run, delete or write. */
const FIND_ACTIONS = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
]);

const GIT_READERS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'blame',
  'rev-parse',
  'ls-files',
  'describe',
  'branch',
  'remote',
]);

/** `git branch` options that keep it listing; without one of the list options a name creates a branch. */
const GIT_BRANCH_LIST_OPTIONS = new Set([
  '-a',
  '--all',
  '-r',
  '--remotes',
  '-l',
  '--list',
  '--show-current',
  '--merged',
  '--no-merged',
  '--contains',
  '--no-contains',
  '--points-at',
]);
const GIT_BRANCH_DISPLAY_OPTIONS = new Set(['-v', '-vv', '--verbose', '--color', '--no-color']);

interface IWord {
  /** The word as the command receives it, quotes removed. */
  readonly text: string;
  /** An unquoted glob character or any `$` expansion: what the command receives is not `text`. */
  readonly expands: boolean;
}

/** Output redirection targets that write nothing. */
const DISCARD_TARGETS = new Set(['/dev/null']);

interface ISegmentScan {
  readonly words: IWord[];
  /** Something the scan could not account for as read-only (a writing redirect, a here-doc). */
  readonly refused: boolean;
}

/** Whether the line runs a nested command: `$(…)`, backticks, `<(…)`, `>(…)` outside single quotes. */
function hasSubstitution(line: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      continue;
    }
    if (char === '\\') {
      index += 1;
      continue;
    }
    const next = line[index + 1];
    if (char === '`' || (char === '$' && next === '(')) return true;
    if (quote === '"') {
      if (char === '"') quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if ((char === '<' || char === '>') && next === '(') return true;
  }
  return false;
}

/**
 * Split one segment into words and judge its redirections. An output redirect is allowed only to a
 * target that writes nothing or to another descriptor; an input redirect only reads; a here-doc is
 * refused because its body lines are not segments of their own.
 */
function scanSegment(segment: string): ISegmentScan {
  const words: IWord[] = [];
  let text = '';
  let expands = false;
  let inWord = false;
  let quote: "'" | '"' | undefined;
  let pendingRedirect: 'output' | 'input' | undefined;
  let refused = false;

  const endWord = (): void => {
    if (!inWord) return;
    if (pendingRedirect === 'output') {
      if (!DISCARD_TARGETS.has(text) || expands) refused = true;
      pendingRedirect = undefined;
    } else if (pendingRedirect === 'input') {
      pendingRedirect = undefined;
    } else {
      words.push({ text, expands });
    }
    text = '';
    expands = false;
    inWord = false;
  };

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else text += char;
      continue;
    }
    if (char === '\\') {
      inWord = true;
      text += segment[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else {
        if (char === '$') expands = true;
        text += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
      continue;
    }
    if (char === ' ' || char === '\t') {
      endWord();
      continue;
    }
    if (char === '>' || char === '<' || (char === '&' && segment[index + 1] === '>')) {
      // A word of digits right before the operator is its descriptor (`2>`), not an argument.
      if (inWord && !/^\d+$/.test(text)) endWord();
      text = '';
      expands = false;
      inWord = false;
      if (char === '&') index += 1;
      const operator = char === '&' ? '>' : char;
      let next = segment[index + 1];
      if (operator === '<' && next === '<') {
        refused = true;
        break;
      }
      if (next === operator || next === '|') {
        index += 1;
        next = segment[index + 1];
      }
      if (next === '&') {
        // Duplicating a descriptor (`2>&1`, `>&-`, `<&0`) opens no file.
        index += 1;
        while (index + 1 < segment.length && /[\d-]/.test(segment[index + 1]!)) index += 1;
        continue;
      }
      pendingRedirect = operator === '>' ? 'output' : 'input';
      continue;
    }
    if (char === '$' || char === '*' || char === '?' || char === '[') expands = true;
    text += char;
    inWord = true;
  }
  if (quote !== undefined) refused = true;
  endWord();
  // A redirect with no target is not something this scan can vouch for.
  if (pendingRedirect !== undefined) refused = true;
  return { words, refused };
}

function isReadOnlyFind(args: readonly IWord[]): boolean {
  return args.every((word) => !word.expands && !FIND_ACTIONS.has(word.text));
}

function isReadOnlyGitBranch(args: readonly IWord[]): boolean {
  const options = args.filter((word) => word.text.startsWith('-'));
  const listing = options.some((word) => GIT_BRANCH_LIST_OPTIONS.has(word.text));
  return (
    options.every(
      (word) => GIT_BRANCH_LIST_OPTIONS.has(word.text) || GIT_BRANCH_DISPLAY_OPTIONS.has(word.text),
    ) &&
    (listing || options.length === args.length)
  );
}

function isReadOnlyGit(args: readonly IWord[]): boolean {
  // Global options (`-c`, `-C`, `--exec-path`, …) change what git runs and where; only the pager
  // switch is known to be harmless.
  const rest = args[0]?.text === '--no-pager' ? args.slice(1) : args;
  const [subcommand, ...subArgs] = rest;
  if (subcommand === undefined || subcommand.expands || !GIT_READERS.has(subcommand.text)) {
    return false;
  }
  if (subArgs.some((word) => word.expands)) return false;
  // `--output` writes a file and `--ext-diff` runs a configured program.
  if (subArgs.some((word) => /^--(output|ext-diff|open-files-in-pager)/.test(word.text))) {
    return false;
  }
  if (subcommand.text === 'branch') return isReadOnlyGitBranch(subArgs);
  if (subcommand.text === 'remote') {
    return subArgs.every((word) => word.text === '-v' || word.text === '--verbose');
  }
  return true;
}

function isReadOnlySegment(words: readonly IWord[]): boolean {
  const [command, ...args] = words;
  if (command === undefined || command.expands) return false;
  // A leading assignment (`PAGER=… git log`) configures what runs; a path is not the built-in.
  if (command.text.includes('=') || command.text.includes('/')) return false;
  if (PLAIN_READERS.has(command.text)) return true;
  if (command.text === 'find') return isReadOnlyFind(args);
  if (command.text === 'git') return isReadOnlyGit(args);
  return false;
}

export interface IReadOnlyCommandContext {
  /**
   * The call runs somewhere other than the session's working directory. Git reads the
   * configuration of the repository it runs in, and another repository's configuration can name
   * programs to run, so git is read-only only where the session already works.
   */
  readonly otherDirectory?: boolean;
}

/**
 * Whether every command the line runs is in the built-in read-only set. A compound line qualifies
 * only when each of its commands does on its own.
 */
export function isReadOnlyCommandLine(
  line: string,
  context: IReadOnlyCommandContext = {},
): boolean {
  if (line.length > MAX_INSPECTED_LENGTH || hasSubstitution(line)) return false;
  const segments = splitCommandSegments(line);
  if (segments.length === 0) return false;
  const scanned = segments.map(scanSegment);
  if (scanned.some((segment) => segment.refused || !isReadOnlySegment(segment.words))) {
    return false;
  }
  const commands = scanned.map((segment) => segment.words[0]!.text);
  // `cd` then `git` runs git in another repository, under that repository's configuration.
  if (commands.includes('git') && (context.otherDirectory === true || commands.includes('cd'))) {
    return false;
  }
  return true;
}
