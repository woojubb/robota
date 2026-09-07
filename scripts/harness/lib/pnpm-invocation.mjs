/**
 * How a written-down `pnpm` command line is read: which packages it selects, and which script it
 * runs on them.
 *
 * Split out of `scan-filter-script-resolves` (issue #2660) because the two halves fail differently
 * and are checked differently. READING a command line is a decidable, tree-free question — given a
 * string, which package tokens and which script token does pnpm see? — so every skip rule below is
 * assertable against a literal. JUDGING one needs the workspace, its manifests and the corpus walk.
 * Keeping them in one file meant the parse's edge cases could only be exercised through a scan run.
 *
 * ## Which way its enumeration fails
 *
 * fail-direction: **under-report**. `PNPM_SUBCOMMANDS` is a closed list, and a sub-command missing
 * from it is read as a script name, which produces a FALSE FINDING against a correct command — the
 * expensive direction. That is why the list is long and why `SCRIPT_NAME` is narrow: a token this
 * module cannot confidently read as a script is dropped rather than guessed at. The cost of a gap
 * is a filter this module declines to judge, which the caller's other guards still cover; the cost
 * of a wrong guess is an accusation against prose that is right.
 */

/**
 * pnpm sub-commands that do NOT resolve to a package script.
 *
 * `test` and `start` are absent ON PURPOSE: pnpm forwards both to the script of that name, so a
 * package without a `test` script cannot serve a filtered `test` invocation — which makes them two
 * of the most valuable tokens in the corpus, not exemptions.
 */
export const PNPM_SUBCOMMANDS = new Set([
  'add',
  'approve-builds',
  'audit',
  'bin',
  'cat-file',
  'cat-index',
  'config',
  'create',
  'dedupe',
  'deploy',
  'dlx',
  'doctor',
  'env',
  'exec',
  'fetch',
  'find-hash',
  'i',
  'ignored-builds',
  'import',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'll',
  'ls',
  'node',
  'outdated',
  'pack',
  'patch',
  'patch-commit',
  'patch-remove',
  'prune',
  'publish',
  'rb',
  'rebuild',
  'remove',
  'rm',
  'root',
  'self-update',
  'server',
  'setup',
  'store',
  'un',
  'uninstall',
  'unlink',
  'up',
  'update',
  'upgrade',
  'version',
  'why',
]);

/** The shape of an npm script name. Anything else is prose, a template slot, or shell syntax. */
export const SCRIPT_NAME = /^[a-z0-9][a-z0-9._:-]*$/i;

/** Trailing markdown/prose punctuation glued to a command token by the sentence around it. */
const TRAILING_PUNCTUATION = /[.,;:)\]`'"*]+$/;

/**
 * Filter tokens pnpm reads as a SELECTOR rather than one package name — a path, a glob, a negation,
 * a dependency-traversal suffix. None names a single package, so none can be checked against one.
 */
export function isSelector(token) {
  return (
    token.startsWith('!') ||
    token.startsWith('.') ||
    token.startsWith('/') ||
    token.includes('*') ||
    token.includes('{') ||
    token.includes('...') ||
    token.includes('[')
  );
}

/**
 * Every `pnpm … --filter <pkg> [--filter <pkg>…] <script>` occurrence in one text.
 *
 * Returns the packages a single invocation selects together with the ONE script it runs — pnpm
 * applies the command to every selected package, so a script missing from any of them is a real
 * finding for that package.
 *
 * The scan forward from `pnpm` consumes options and filters until it meets a token that is neither,
 * which is the command. Two shapes are read specially because reading them literally would be
 * wrong: `--filter=<pkg>` (and the `-F` alias) carries its value in the same token, and
 * `run <script>` puts the script AFTER the sub-command — taking `run` as the script name would
 * misread every correct `run` invocation in the repository.
 */
export function filterScriptOccurrences(text) {
  const source = String(text ?? '');
  const occurrences = [];
  const invocations = /\bpnpm\b/g;
  let match;
  while ((match = invocations.exec(source)) !== null) {
    let cursor = match.index + 'pnpm'.length;
    const packages = [];
    let script = null;
    for (;;) {
      const gap = /^[ \t]+/.exec(source.slice(cursor, cursor + 64));
      if (!gap) break;
      const at = cursor + gap[0].length;
      const tail = source.slice(at);
      // `-F` is pnpm's documented alias for `--filter`, and is tried BEFORE the generic option
      // rule below — which would otherwise eat it and read the package name as the script.
      const filter = /^(?:--filter|-F)(?:=|[ \t]+)("?)([^\s"'`]+)\1/.exec(tail);
      if (filter) {
        packages.push(filter[2]);
        cursor = at + filter[0].length;
        continue;
      }
      const option = /^(?:-[A-Za-z]+|--[a-z][a-z0-9-]*(?:=[^\s]+)?)(?=\s|$)/.exec(tail);
      if (option) {
        cursor = at + option[0].length;
        continue;
      }
      const run = /^run(?:-script)?[ \t]+([^\s]+)/.exec(tail);
      if (run) {
        script = run[1];
        cursor = at;
        break;
      }
      const token = /^([^\s]+)/.exec(tail);
      if (token) {
        script = token[1];
        cursor = at;
      }
      break;
    }
    if (packages.length === 0 || script === null) continue;
    occurrences.push({
      packages,
      script: script.replace(TRAILING_PUNCTUATION, ''),
      line: source.slice(0, cursor).split('\n').length,
    });
  }
  return occurrences;
}
