#!/usr/bin/env node

/**
 * A checked-in script runs on whatever machine clones this repo, and that machine is not always the
 * one it was written on. This scan mechanizes the "Host Platform Is Read, Never Assumed" rule in
 * `.agents/rules/operational.md` for the half of it a machine can check: the flags whose GNU form
 * and BSD/macOS form differ.
 *
 * These are the ones that MATTER because they do not error in a way that names their cause:
 *
 *   sed -i        macOS reads the next argument as the backup suffix and reports success
 *   readlink -f   absent on macOS; the path silently comes back unresolved
 *   stat -c       macOS wants -f, and fails with an opaque usage line
 *   date -d       macOS wants -v; a wrong date is parsed, not rejected
 *   grep -P       absent on macOS BSD grep
 *   base64 -w     absent on macOS, where output is unwrapped anyway
 *   find -printf  absent on macOS BSD find
 *   xargs -r      absent on macOS; the flag is consumed as a command name
 *
 * A COMMENT is not executed, so prose that discusses one of these — including the rule text and this
 * file — is not a finding. A test FIXTURE that feeds one to a guard under test is a string, not a
 * command this repo runs, so `__tests__` trees are excluded and that exclusion is REPORTED.
 *
 * STATED LIMIT, not a silent one: only SHELL files are examined. A `.mjs`/`.ts` file that shells out
 * is out of scope, and the reason is measured rather than assumed — the first version scanned them
 * and immediately refused a JS **string literal** describing this very scan, because a flag named in
 * prose inside a string is indistinguishable from one being run without evaluating the file. A guard
 * that fires on correct work is one people learn to route around. Node code has `fs` and should not
 * be spelling these flags at all; if that stops being true, the narrower rule to add is "flag a
 * string handed to a shell-executing call", not "flag every string".
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { extensionOf, scriptFilters } from './script-language.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Script trees whose contents this repo actually executes. */
const SCAN_ROOTS = ['scripts', '.husky', '.claude/hooks'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__tests__', 'fixtures']);
/**
 * Which files are shell scripts — INFRA-115.
 *
 * An extensionless file is a shell script if it SAYS SO. Husky hooks carry no extension, and so may
 * any hook added later. That replaced a set of directories allowed to hold extensionless scripts,
 * which had two problems raised in review of #1590: `.claude/hooks` was not in it even though it is
 * a governed root, and the membership test compared against the FIRST path segment, so a
 * multi-segment root could never have matched even after being added. A property of the file beats
 * a list of places the property is assumed to hold — the list is what goes stale.
 *
 * Both halves now come from `script-language.mjs`. THIS FILE IS WHERE THE ASYMMETRY STARTED: it
 * admitted `dash`, `ksh` and `ash` by shebang against `/\.(sh|bash|zsh)$/`, and
 * `scan-symlink-following-enumeration.mjs` copied the three names — into the file whose comment
 * cites this scan as the lesson to follow. Fixing only the copy would have left the original
 * self-disagreeing, which is why the owner is a table both read rather than a correction to one.
 */
const SCRIPTS = scriptFilters(['shell']);

/**
 * One entry per command, read as OPTIONS rather than matched as text.
 *
 * The first three versions of this table were regexes of the shape
 * `command\s+(-[a-zA-Z]*\s+)*-TARGET`, and each review found another spelling they missed. The last
 * was fused short clusters — `grep -iP`, `sed -ni`, `stat -Lc`, `xargs -0r` — where the optional
 * leading-flags group swallows the whole token and the required alternation then needs the target at
 * the start of what is left. Four real idioms, all silently clean. A guard whose entire purpose is
 * to remove silent misses cannot keep having them.
 *
 * So the options are WALKED instead. `short` is the target letter, and `valueTaking` names the short
 * letters that consume the rest of their cluster as a VALUE — which is what keeps `grep -eP` (a
 * pattern of "P") from reading as `grep -P`. The same shape closed the same class in
 * `branch-guard.sh`. (#1590 review)
 */
const DIVERGENT = [
  {
    flag: 'sed -i',
    command: 'sed',
    short: 'i',
    long: ['--in-place'],
    valueTaking: 'ef',
    portable: 'rewrite the file with node/python3, or read + write explicitly',
  },
  {
    flag: 'readlink -f',
    command: 'readlink',
    short: 'f',
    long: ['--canonicalize'],
    valueTaking: '',
    portable: 'node -e "console.log(require(\'fs\').realpathSync(p))"',
  },
  {
    flag: 'stat -c',
    command: 'stat',
    short: 'c',
    long: ['--format', '--printf'],
    // GNU `stat -f` is `--file-system`, a BOOLEAN — listing it as value-taking made the walk stop at
    // the `f` in a fused `-fc` and miss the real `-c` behind it. (#1590 review)
    valueTaking: '',
    portable: 'node -e with fs.statSync',
  },
  {
    flag: 'date -d',
    command: 'date',
    short: 'd',
    long: ['--date'],
    valueTaking: 'f',
    portable: 'node -e with Date arithmetic',
  },
  {
    flag: 'grep -P',
    command: 'grep',
    short: 'P',
    long: ['--perl-regexp'],
    valueTaking: 'efmABCDd',
    portable: 'rg, or grep -E',
  },
  {
    flag: 'base64 -w',
    command: 'base64',
    short: 'w',
    long: ['--wrap'],
    valueTaking: '',
    portable: 'base64 (macOS does not wrap) or node Buffer',
  },
  {
    // `-printf` is a long-form primary in find's own grammar, not a short cluster.
    flag: 'find -printf',
    command: 'find',
    short: null,
    long: ['-printf'],
    valueTaking: '',
    portable: 'find -exec, or a node walk',
  },
  {
    flag: 'xargs -r',
    command: 'xargs',
    short: 'r',
    long: ['--no-run-if-empty'],
    valueTaking: 'adEIiLnPs',
    portable: 'guard the empty case before the pipe',
  },
];

/**
 * Where one command ends and the next begins.
 *
 * PUNCTUATION ONLY. The first spelling also listed the shell keywords `do`, `done`, `then`, `else`,
 * `fi`, `esac` — but those are only keywords in command position, and as an ARGUMENT (a file named
 * `done`, say) they are ordinary words. Ending the walk on one is a silent miss of any flag after
 * it, which is the failure this scan exists to remove. Real keyword boundaries carry punctuation
 * (`…; done`) and are caught by the punctuation rule. (#1590 review)
 */
const SEPARATOR = /^(;|&|&&|\||\|\||\)|\(|\{|\})$/;

/**
 * The EXECUTABLE part of a logical line: quoted spans neutralised, then any trailing comment cut.
 *
 * Both problems are the same problem — text that is not code being read as code — and both were
 * found in the same review round:
 *
 *   cmd args # avoid sed -i here      the comment was scanned and reported as a real invocation
 *   sed -i 's/a;b/c/' f              the `;` inside the quotes is not a command separator
 *
 * A quoted span is replaced character-for-character with `Q`, so every offset and word boundary is
 * preserved while nothing inside it can be mistaken for a separator, a comment marker, or a flag. A
 * `#` only starts a comment when it is unquoted AND begins a word — `foo#bar` is one word, and
 * `sed -i` is not documentation just because a `#` appears later in an argument. (#1590 review)
 */
function executablePart(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    // A SINGLE-quoted span has no escapes at all: a backslash is a literal character there and only
    // the closing quote ends it. Applying the double-quote rule here would desynchronise on
    // `'it\'` — which is a complete, closed span in shell.
    if (quote === "'") {
      out += ch === "'" ? ch : 'Q';
      if (ch === "'") quote = null;
      continue;
    }
    // Inside DOUBLE quotes a backslash escapes the next character, so `\"` does NOT close the span.
    // Reading it as a close desynchronised everything after it: the next real `"` then read as an
    // OPEN, and the rest of the line was masked as quoted data — silently swallowing any divergent
    // command in it. That is the exact false-negative class this scan exists to remove, in its own
    // parser. (#1590 review)
    if (quote === '"') {
      if (ch === '\\' && i + 1 < line.length) {
        out += 'QQ';
        i++;
        continue;
      }
      out += ch === '"' ? ch : 'Q';
      if (ch === '"') quote = null;
      continue;
    }
    // Unquoted: a backslash escapes the next character, so `\"` does not OPEN a span either, and an
    // escaped `;`/`#` (`find … -exec … \;`) is a literal, not a separator or a comment.
    if (ch === '\\' && i + 1 < line.length) {
      out += '\\Q';
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += ch;
  }
  return out;
}

/**
 * Whether `command` is invoked with the divergent option somewhere in this logical line.
 *
 * Whitespace splitting, stated as a limit: a quoted argument containing spaces becomes several
 * words. That cannot produce a MISS — an option never hides inside a quoted operand it would have to
 * be outside of to take effect — and the false-positive direction is bounded by the separator and
 * value-taking rules below.
 */
function invokesWith(line, { command, short, long, valueTaking }) {
  // A command position can open without whitespace in front of it — `$(sed -i …)`, `` `sed …` ``,
  // `(sed …`, `|sed …`. Splitting on whitespace alone left the word as `$(sed`, which matched
  // nothing, so the opening punctuation is stripped before the comparison. (#1590 review)
  //
  // The RAW word is kept alongside, because a leading `;`/`&`/`|` is also what makes a word a
  // SEPARATOR: stripping it for both purposes at once would have let the walk run past the end of
  // its own command and blame it for a later one's flag.
  //
  // Three readings of the same words, because they answer three different questions:
  //   raw      — is this word a SEPARATOR (a leading `;`/`&`/`|`/`)` ends the command it follows)
  //   argWord  — leading punctuation removed only; `--wrap=0` must keep its `=`
  //   cmdWord  — the last segment after any opener, so `x=$(sed` and `` x=`stat `` name the command
  const code = executablePart(line).trim();
  if (code === '') return false;
  const raw = code.split(/\s+/);
  const argWords = raw.map((w) => w.replace(/^[$({`;|&]+/, ''));
  const cmdWords = raw.map((w) => w.split(/[$(`{;|&=]/).pop() ?? w);
  const words = argWords;
  for (let i = 0; i < cmdWords.length; i++) {
    const w = cmdWords[i];
    if (w !== command && !w.endsWith(`/${command}`)) continue;
    for (let j = i + 1; j < words.length; j++) {
      const arg = words[j];
      // A separator GLUED to the previous argument ends the command just as a spaced one does:
      // `file;othercmd -i` walked on and blamed `sed` for the next command's flag. Safe to test the
      // whole token now that a quoted `;` has been neutralised above. (#1590 review)
      if (SEPARATOR.test(raw[j]) || /[;|]/.test(raw[j]) || /^[&)]/.test(raw[j])) break;
      // A long option, with or without an attached `=value`.
      if (long.some((l) => arg === l || arg.startsWith(`${l}=`))) return true;
      if (short === null) continue;
      if (arg === '--') break;
      if (!arg.startsWith('-') || arg.length < 2 || arg.startsWith('--')) continue;
      for (const ch of arg.slice(1)) {
        if (ch === short) return true;
        // Everything after a value-taking letter is that option's value, not more flags.
        if (valueTaking.includes(ch)) break;
      }
    }
  }
  return false;
}

/**
 * A line whose executable part is empty — the flag is being DISCUSSED, not run.
 *
 * `#` ONLY, because that is the whole of shell comment syntax. The first version also accepted
 * `//`, `*` and `/*`, carried over from when this scan read `.mjs` files too, and once the scope
 * narrowed to shell they stopped being harmless: `*) sed -i 's/a/b/' f ;;` is the default branch of
 * a `case`, a perfectly ordinary line of shell, and it was skipped as a comment. A rule that hides
 * real commands is worse than no rule — this scan exists to remove silent misses. (#1590 review)
 */
function isComment(line) {
  return line.trimStart().startsWith('#');
}

/**
 * The LOGICAL lines — a trailing backslash continues onto the next one, and the shell reads the
 * result as a single command. A line-by-line match missed
 *
 *     sed \
 *       -i 's/a/b/' f
 *
 * because no single line holds `sed … -i`: a portability bug passing in silence, which is the class
 * this scan exists to catch. Raised in review of this change and closed rather than documented.
 *
 * A comment is NOT continued: bash ends a comment at the newline whatever the last character is, so
 * joining there would splice real code onto prose and invent a command nobody wrote.
 *
 * Each logical line carries the 1-based number of the line it STARTED on, so a finding still points
 * at something a reader can open.
 */
function logicalLines(text) {
  const raw = text.split('\n');
  const out = [];
  let buffer = null;
  let startLine = 0;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (buffer === null) {
      if (isComment(line)) {
        out.push({ text: line, line: i + 1, comment: true });
        continue;
      }
      buffer = line;
      startLine = i + 1;
    } else {
      buffer = `${buffer} ${line.replace(/^\s+/, '')}`;
    }
    if (/\\\s*$/.test(buffer)) {
      buffer = buffer.replace(/\\\s*$/, '');
      continue;
    }
    out.push({ text: buffer, line: startLine, comment: false });
    buffer = null;
  }
  if (buffer !== null) out.push({ text: buffer, line: startLine, comment: false });
  return out;
}

/**
 * Whether an extensionless file declares itself a shell script.
 *
 * ONLY a file that is not there answers "no". The first spelling caught every read error and
 * returned `false`, so a permission-denied or transiently-unreadable governed script dropped out of
 * the scan AND out of `filesExamined` with no signal at all — the "size of what it examined"
 * self-report would have under-counted silently. That is the exact shape the rule this same change
 * adds argues against: fail loudly rather than silently produce a wrong result. Anything other than
 * a missing file is rethrown and stops the scan with its cause. (#1590 review)
 */
function isShellShebang(absolute) {
  try {
    return SCRIPTS.shebang.test(readFileSync(absolute, 'utf8').split('\n', 1)[0] ?? '');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new Error(
      `could not read ${absolute} to decide whether it is a shell script: ${error?.message ?? error}. ` +
        'This scan will not report a pass over a file it could not read.',
      { cause: error },
    );
  }
}

function walk(root, relDir, out, skipped) {
  const absolute = path.join(root, relDir);
  if (!existsSync(absolute)) return out;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        skipped.push(rel);
        continue;
      }
      walk(root, rel, out, skipped);
    } else if (entry.isFile()) {
      if (SCRIPTS.hasScriptExtension(entry.name)) {
        out.push(rel);
      } else if (extensionOf(entry.name) === '' && isShellShebang(path.join(root, rel))) {
        out.push(rel);
      }
    }
  }
  return out;
}

export function findPortabilityFindings(root = WORKSPACE_ROOT) {
  const missing = SCAN_ROOTS.filter((dir) => !existsSync(path.join(root, dir)));
  if (missing.length > 0)
    throw new Error(
      `governed tree(s) absent under ${root}: ${missing.join(', ')}. This scan will not report a ` +
        'pass over scripts it could not read.',
    );

  const findings = [];
  const skipped = [];
  let filesExamined = 0;

  for (const dir of SCAN_ROOTS) {
    const stat = statSync(path.join(root, dir));
    const files = stat.isFile() ? [dir] : walk(root, dir, [], skipped);
    for (const rel of files) {
      filesExamined++;
      for (const logical of logicalLines(readFileSync(path.join(root, rel), 'utf8'))) {
        if (logical.comment) continue;
        // EVERY entry that matches, not the first. `sed -i … && stat -c …` is one logical line with
        // two divergent commands, and breaking on the first reported one and dropped the other —
        // a silent miss, in the scan that exists to remove them. (#1590 review)
        for (const entry of DIVERGENT) {
          const { flag, portable } = entry;
          if (invokesWith(logical.text, entry)) {
            findings.push({
              file: rel,
              line: logical.line,
              flag,
              portable,
              text: logical.text.trim().slice(0, 120),
            });
          }
        }
      }
    }
  }

  return { findings, filesExamined, skipped };
}

export function main() {
  const { findings, filesExamined, skipped } = findPortabilityFindings();
  const scope = `${filesExamined} script(s) across ${SCAN_ROOTS.join(', ')}`;
  process.stdout.write(`::examined:: ${filesExamined} shell scripts\n`);
  const dropped =
    skipped.length > 0 ? ` (${skipped.length} director(y/ies) skipped: ${skipped.join(', ')})` : '';

  if (findings.length === 0) {
    process.stdout.write(`shell portability scan passed — examined ${scope}${dropped}.\n`);
    return;
  }
  process.stdout.write(`shell portability scan failed — examined ${scope}${dropped}:\n`);
  for (const f of findings) {
    process.stdout.write(
      `  ${f.file}:${f.line}  ${f.flag} — ${f.text}\n      use instead: ${f.portable}\n`,
    );
  }
  process.stdout.write(
    '\nThese flags differ between GNU and BSD/macOS and fail without naming their cause.\n' +
      'See "Host Platform Is Read, Never Assumed" in .agents/rules/operational.md.\n',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
