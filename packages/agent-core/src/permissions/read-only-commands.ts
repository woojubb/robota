/**
 * The built-in read-only shell commands: a call that only looks is decided like a read, so it runs
 * without a prompt in every mode (issue #3082).
 *
 * The set is fixed, not configurable: a user who wants a prompt for one of these adds an `ask` or
 * `deny` rule, which the gate checks first. Every rule below fails toward "not read-only" — a line
 * this module cannot fully account for is an ordinary command and takes the ordinary path.
 *
 * Two limits make "looks like a read" mean what `Read` means. The line stays inside the workspace:
 * no absolute, home-relative, climbing or provider path, no glob that could match `..`, and every
 * path operand resolves inside once symlinks are followed (by the host's resolver). And it uses only
 * printable ASCII syntax every shell the tool may run (sh, bash, zsh, fish, PowerShell) reads the
 * same way: plain words, quotes, pipes and separators, and redirects — no expansion, substitution,
 * grouping or comment.
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

/**
 * Options that read a file named elsewhere or follow symlinks while recursing, keyed by command.
 * Short letters are matched inside a cluster (`-rnR`).
 */
const SYMLINK_OR_FILE_OPTIONS: Readonly<
  Record<string, { short: string; long: readonly string[] }>
> = {
  grep: { short: 'Rf', long: ['--dereference-recursive', '--file'] },
  ls: { short: 'L', long: ['--dereference'] },
  du: { short: 'L', long: ['--dereference'] },
  find: { short: '', long: [] },
};

/** Any option whose value is a file to read, or a list of files: `--file`, `--exclude-from`, `-files0-from`. */
const FILE_VALUED_OPTION = /^--?[A-Za-z0-9-]*(file|from|contents)(=|$)/;

function usesRefusedOption(command: string, args: readonly IWord[]): boolean {
  if (optionWords(args).some((word) => FILE_VALUED_OPTION.test(word.text))) return true;
  if (command === 'find') {
    return optionWords(args).some((word) => word.text === '-L' || word.text === '-follow');
  }
  const refused = SYMLINK_OR_FILE_OPTIONS[command];
  if (refused === undefined) return false;
  return optionWords(args).some(({ text }) => {
    if (text.startsWith('--'))
      return refused.long.some((long) => text === long || text.startsWith(`${long}=`));
    return /^-[A-Za-z]/.test(text) && [...refused.short].some((letter) => text.includes(letter));
  });
}

const GIT_READERS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'ls-files',
  'describe',
  'branch',
  'remote',
]);

/** `git branch` options that put it in list mode; without one of them a name creates a branch. */
const GIT_BRANCH_LIST_OPTIONS = new Set([
  '-l',
  '--list',
  '--show-current',
  '--merged',
  '--no-merged',
  '--contains',
  '--no-contains',
  '--points-at',
]);
const GIT_BRANCH_DISPLAY_OPTIONS = new Set([
  '-a',
  '--all',
  '-r',
  '--remotes',
  '-v',
  '-vv',
  '--verbose',
  '--color',
  '--no-color',
]);

interface IWord {
  /** The word as the command receives it, quotes removed. */
  readonly text: string;
  /** An unquoted glob character: what the command receives is not `text`. */
  readonly expands: boolean;
}

/** Output redirection targets that write nothing. */
const DISCARD_TARGETS = new Set(['/dev/null']);

/**
 * The only characters an unquoted word may carry. Everything else — `$`, `{`, `(`, `#`, `!`, `^`,
 * backslash, backtick — means expansion, substitution, a comment, or a construct that differs
 * between bash, zsh, fish and PowerShell, and a line using one is not inspected further.
 */
const UNQUOTED_WORD_CHARACTER = /[A-Za-z0-9_./:=@+,*?[\]~-]/;
/** Inside double quotes these still expand or escape. */
const DOUBLE_QUOTE_ACTIVE = new Set(['$', '`', '\\', '!']);
const GLOB_CHARACTERS = new Set(['*', '?', '[']);

/**
 * Whether a word names something outside the session's working directory: an absolute or
 * home-relative path, or a `..` that climbs, also as an option's value (`--file=/x`, `-f/x`).
 * The shell tool itself is not confined, so looking outside is not treated as a read.
 */
function leavesWorkspace(text: string): boolean {
  return (
    /(^|[=,:])[/~]/.test(text) ||
    /^-[A-Za-z]+[/~]/.test(text) ||
    /(^|[/=,:]|^-[A-Za-z]+)\.\.(\/|$)/.test(text) ||
    // A drive or provider prefix (`C:x`, `Env:`, `HKCU:`) names another place in PowerShell.
    /(^|[=,])[A-Za-z][A-Za-z0-9]*:/.test(text) ||
    globMayClimb(text)
  );
}

/**
 * Whether a glob could match `..`, which some shells (dash, bash before 5.2) do for a pattern
 * starting with `.`, `?` or `[`. A glob is accepted only in the last path segment, and not there
 * in those forms.
 */
function globMayClimb(text: string): boolean {
  const segments = text.split('/');
  const hasGlob = (segment: string): boolean => /[*?[]/.test(segment);
  if (segments.slice(0, -1).some(hasGlob)) return true;
  const last = segments[segments.length - 1]!;
  return hasGlob(last) && /^[.?[]/.test(last);
}

/**
 * Whether the line expands or substitutes anything outside single quotes. Checked on the whole
 * line, before it is cut into segments, because the cut happens at substitution boundaries.
 */
function hasActiveExpansion(line: string): boolean {
  let quote: "'" | '"' | undefined;
  for (const char of line) {
    if (quote === "'") {
      if (char === "'") quote = undefined;
      continue;
    }
    if (char === '$' || char === '`' || char === '\\') return true;
    if (quote === '"') {
      if (char === '"') quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(' || char === ')' || char === '{' || char === '}') return true;
  }
  return false;
}

interface ISegmentScan {
  readonly words: IWord[];
  /** Something the scan could not account for as read-only. */
  readonly refused: boolean;
}

/**
 * Split one segment into words and judge its redirections. An output redirect is allowed only to a
 * target that writes nothing or to another descriptor; an input redirect only from inside the
 * workspace; a here-doc is refused because its body lines are not segments of their own.
 */
function scanSegment(segment: string): ISegmentScan {
  const words: IWord[] = [];
  let text = '';
  let expands = false;
  let inWord = false;
  let quote: "'" | '"' | undefined;
  let pendingRedirect: 'output' | 'input' | 'duplicate' | undefined;
  let refused = false;

  const endWord = (): void => {
    if (!inWord) return;
    if (pendingRedirect === 'output') {
      if (!DISCARD_TARGETS.has(text) || expands) refused = true;
    } else if (pendingRedirect === 'duplicate') {
      // `2>&1`, `>&-`: another descriptor. Anything else after `>&` is a file (`>&out` = `&>out`).
      if (!/^(\d+|-)$/.test(text)) refused = true;
    } else if (pendingRedirect === 'input') {
      if (expands || leavesWorkspace(text)) refused = true;
    } else {
      words.push({ text, expands });
    }
    pendingRedirect = undefined;
    text = '';
    expands = false;
    inWord = false;
  };

  for (let index = 0; index < segment.length && !refused; index += 1) {
    const char = segment[index]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else text += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (DOUBLE_QUOTE_ACTIVE.has(char)) refused = true;
      else text += char;
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
      if (operator === '<' && (next === '<' || next === '>')) {
        refused = true;
        break;
      }
      if (next === operator || next === '|') {
        index += 1;
        next = segment[index + 1];
      }
      if (next === '&' && char !== '&') {
        index += 1;
        pendingRedirect = 'duplicate';
        continue;
      }
      pendingRedirect = operator === '>' ? 'output' : 'input';
      continue;
    }
    if (!UNQUOTED_WORD_CHARACTER.test(char)) {
      refused = true;
      break;
    }
    // `HEAD~1` is a revision; a leading `~` is the home directory, which `leavesWorkspace` refuses.
    if (GLOB_CHARACTERS.has(char)) expands = true;
    text += char;
    inWord = true;
  }
  if (quote !== undefined) refused = true;
  endWord();
  // A redirect with no target is not something this scan can vouch for.
  if (pendingRedirect !== undefined) refused = true;
  return { words, refused };
}

/** The words before `--` that start with `-`; after `--` every word is an operand. */
function optionWords(args: readonly IWord[]): IWord[] {
  const end = args.findIndex((word) => word.text === '--');
  return (end < 0 ? args : args.slice(0, end)).filter((word) => word.text.startsWith('-'));
}

function isReadOnlyFind(args: readonly IWord[]): boolean {
  return args.every((word) => !word.expands && !FIND_ACTIONS.has(word.text));
}

/** Mirrors git's own rule: only these put `git branch` in list mode, where names are patterns. */
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
  // `-X` and `-O` read an exclude or order file named anywhere.
  if (subArgs.some((word) => /^-[XO]/.test(word.text))) return false;
  // `--no-index` compares arbitrary files rather than the repository.
  if (subArgs.some((word) => /^--(output|ext-diff|open-files-in-pager|no-index)/.test(word.text))) {
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
  // A leading `@` splats a variable in PowerShell and a leading `=` names a path in zsh.
  if (args.some((word) => /^[@=]/.test(word.text))) return false;
  // An unquoted glob expands to names the resolver never sees — a symlink out, or a file named
  // like an option (`-L`) — and for `echo` it lists a directory wherever it is.
  if (args.some((word) => word.expands)) return false;
  if (command.text === 'echo') return true;
  if (args.some((word) => leavesWorkspace(word.text))) return false;
  if (usesRefusedOption(command.text, args)) return false;
  // `cd` alone goes home and `cd -` goes back; only a named directory inside the workspace stays.
  if (command.text === 'cd') return args.length === 1 && args[0]!.text !== '-' && !args[0]!.expands;
  if (PLAIN_READERS.has(command.text)) return true;
  if (command.text === 'find') return isReadOnlyFind(args);
  if (command.text === 'git') return isReadOnlyGit(args);
  return false;
}

/** Commands whose operands are not paths the command opens. */
const NON_PATH_OPERANDS = new Set(['echo', 'which', 'git']);

/**
 * Resolve every operand that could be a path, following symlinks, and require it to stay inside the
 * workspace — the check `Read` makes. A `cd` moves the base for the commands after it.
 */
function operandsStayInWorkspace(
  segments: readonly (readonly IWord[])[],
  resolve: TResolveInWorkspace | undefined,
): boolean {
  let base: string | undefined;
  for (const [command, ...args] of segments) {
    if (NON_PATH_OPERANDS.has(command!.text)) continue;
    const options = new Set(optionWords(args));
    for (const word of args) {
      if (options.has(word) || word.text === '--') continue;
      if (resolve === undefined) return false;
      const resolved = resolve(base, word.text);
      if (resolved === undefined) return false;
      if (command!.text === 'cd') base = resolved;
    }
  }
  return true;
}

/**
 * Resolve `path` against `base` (the working directory when absent), following symlinks, and return
 * where it really is — or `undefined` when that is outside the workspace. A path that does not
 * exist resolves through its nearest existing ancestor.
 */
export type TResolveInWorkspace = (base: string | undefined, path: string) => string | undefined;

export interface IReadOnlyCommandContext {
  /**
   * The call runs somewhere other than the session's working directory, so its relative paths are
   * not the workspace's and git would read another repository's configuration, which can name
   * programs to run.
   */
  readonly otherDirectory?: boolean;
  /**
   * Supplied by a host with a filesystem. Without it a command with a path operand is not
   * read-only, since a symlink inside the workspace can point anywhere.
   */
  readonly resolveInWorkspace?: TResolveInWorkspace;
}

/**
 * Whether every command the line runs is in the built-in read-only set. A compound line qualifies
 * only when each of its commands does on its own.
 */
export function isReadOnlyCommandLine(
  line: string,
  context: IReadOnlyCommandContext = {},
): boolean {
  if (context.otherDirectory === true) return false;
  if (line.length > MAX_INSPECTED_LENGTH || hasActiveExpansion(line)) return false;
  // Other shells read some non-ASCII characters as syntax (PowerShell's curly quotes and dashes).
  if (/[^\t\n\x20-\x7e]/.test(line)) return false;
  const segments = splitCommandSegments(line);
  if (segments.length === 0) return false;
  const scanned = segments.map(scanSegment);
  if (scanned.some((segment) => segment.refused || !isReadOnlySegment(segment.words))) {
    return false;
  }
  const commands = scanned.map((segment) => segment.words[0]!.text);
  // `cd` then `git` runs git in another repository, under that repository's configuration.
  if (commands.includes('git') && commands.includes('cd')) return false;
  return operandsStayInWorkspace(
    scanned.map((segment) => segment.words),
    context.resolveInWorkspace,
  );
}
