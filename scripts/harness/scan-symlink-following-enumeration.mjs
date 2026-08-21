#!/usr/bin/env node

/**
 * INFRA-105 (#1884) — a committed script must not enumerate files by following symlinks.
 *
 * In a pnpm workspace `packages/<a>/node_modules/@scope/<b>` is a symlink to `packages/<b>`, and
 * `node_modules/.pnpm` holds content hard-linked into every other project on the machine. An
 * enumeration that follows symlinks therefore reaches both, and a bulk edit built on it writes where
 * nothing downstream can see: `git status` does not look outside the work tree, and every scan in
 * this directory reads `git ls-files`, which cannot list `node_modules` at all.
 *
 * `bulk-edit-guard.sh` covers the command an agent runs. This covers the script somebody commits,
 * which the hook never sees again once it is a file.
 *
 * WHY FOUR SPELLINGS AND NOT "RECURSIVE ENUMERATION". Measured on a directory holding one symlink to
 * a tree with one matching file: `find` without `-L`, `grep -r`, `rg` without `--follow`, bash and
 * zsh `**`, Node's `fs.globSync` and python's `pathlib.Path.rglob` all returned 0 — they do not
 * traverse. `find -L`, `grep -R`, `rg --follow` and python's `glob.glob`/`iglob` returned 1. Aiming
 * at the general shape would fail correct scripts until the scan was removed; aiming at the measured
 * four leaves a rule that can stay on, and each finding is one flag away from clean.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { enumerateFiles } from './enumerate-files.mjs';
import { extensionOf, scriptFilters } from './script-language.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

export const HAZARD_TABLE = path.join(
  WORKSPACE_ROOT,
  'scripts/harness/symlink-following-hazards.tsv',
);
const ATTRIBUTE_LINES = path.join(WORKSPACE_ROOT, '.claude/hooks/lib/attribute-lines.sh');

/**
 * The hazardous spellings — read from the table `.claude/hooks/bulk-edit-guard.sh` also reads.
 *
 * They used to be four regexes here and four rules there, and only the hook's were ever corrected.
 * Worse, each entry here hand-rolled its own bound on what may stand between a command and its flag,
 * and the three that had one were all DIFFERENT: `find` used `(?:-[^\s-][^\s]*\s+)*`, `grep` used
 * `(?:-[a-z][a-z]*\s+)*`, and `rg` used a lazy unbounded `(?:[^\s]+\s+)*?` that crossed `|`, `;`
 * and `&&` alike. Correcting one left the others standing and guaranteed a fifth ad-hoc bound the
 * next time a spelling was added. (INFRA-109)
 */
export function hazardRows(tablePath = HAZARD_TABLE) {
  return readFileSync(tablePath, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'))
    .filter((fields) => fields.length >= 5 && fields[0] && fields[0] !== 'id')
    .map(([id, command, short, long, remedy]) => ({ id, command, short, long, remedy }));
}

/**
 * The fallback matcher, for a file whose language is NOT shell.
 *
 * There is ONE bound and it is generated, so adding a row adds no pattern to invent — which is the
 * property the four hand-written bounds did not have. It is still a weaker reading than the shell
 * one below: a `.mjs` or `.yml` line is matched as TEXT, because shell tokenization of a JavaScript
 * statement is not a reading of anything. Naming the language of a payload embedded in another
 * language — a `run:` block, an `execSync` argument, a heredoc body — is INFRA-123, and this is the
 * limit that item exists for. Stated here rather than left for the next reviewer to measure.
 */
export function fallbackPattern({ command, short, long }) {
  const spellings = [];
  if (short && short !== '-') spellings.push(`-[a-zA-Z]*${short}[a-zA-Z]*`);
  for (const form of (long ?? '').split(',')) {
    if (form && form !== '-') spellings.push(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  return new RegExp(String.raw`\b${command}\s+(?:[^\s]+\s+)*?(?:${spellings.join('|')})\b`);
}

/**
 * The one rule that is not a command-and-flag, so it is not in the table: `glob.glob` is a CALL, and
 * there is no option to attribute. Keeping it here rather than inventing a table column for a shape
 * with one member.
 */
const CALL_RULES = [
  {
    id: 'python glob.glob',
    pattern: /\bglob\.(?:glob|iglob)\s*\(/,
    remedy: 'use pathlib Path(...).rglob, which does not follow symlinks (measured)',
  },
];

/**
 * The names a python file has bound to `glob.glob`/`iglob` by importing them (issue #1919).
 *
 * `CALL_RULES` matches the `glob.` prefix, which is one spelling of four. Measured, all three others
 * reach the same symlink-following function and none was reported:
 *
 *     from glob import glob;         glob("**")
 *     import glob as g;              g.glob("**")
 *     from glob import iglob as it;  it("**")
 *
 * `from glob import glob` is the more idiomatic of the two forms, so the uncovered spellings are not
 * exotic. No production instance exists today — every `glob` import in the tree is a test fixture
 * that also writes `glob.glob(`, so the call rule already catches it — which makes this preventive
 * rather than remedial, and is why it is a widening of one rule rather than the payload reader
 * INFRA-123 describes.
 *
 * PYTHON ONLY, deliberately — and the filter is the SECOND defence, not the first. The patterns
 * below read python import syntax (`from glob import glob`), which JavaScript's `from 'glob'` does
 * not match, so the JS package of the same name is already unreachable by them. Measured both ways:
 * with the language filter removed, the JS case still reports nothing.
 *
 * The filter stays because the first defence is a property of the regex, and a later edit that
 * loosens the regex would silently lose it. `import glob from 'glob'` names a package that does NOT
 * follow symlinks, and reporting it is the false positive INFRA-123 records as the reason the first
 * widening was withdrawn — too expensive to leave resting on one line's exact shape.
 */
function globBindingsIn(content) {
  const bound = new Set();
  // `import glob` / `import glob as g` — the module, bound under its own name or an alias
  for (const match of content.matchAll(
    /^[ \t]*import[ \t]+glob(?:[ \t]+as[ \t]+([A-Za-z_]\w*))?[ \t]*$/gm,
  )) {
    bound.add(match[1] ?? 'glob');
  }
  // `from glob import glob, iglob as it` — the FUNCTIONS, each under its own name or an alias
  for (const match of content.matchAll(/^[ \t]*from[ \t]+glob[ \t]+import[ \t]+([^\n#]+)/gm)) {
    for (const clause of match[1].split(',')) {
      const named = clause.trim().match(/^(glob|iglob)(?:[ \t]+as[ \t]+([A-Za-z_]\w*))?$/);
      if (named) bound.add(named[2] ?? named[1]);
    }
  }
  return bound;
}

/** A call through one of those names — `g.glob(…)` for a module binding, `it(…)` for a function one. */
function boundGlobCallPattern(names) {
  const alternation = [...names]
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`\\b(?:${alternation})\\s*(?:\\.\\s*i?glob\\s*)?\\(`);
}

/**
 * Which files this scan reads, and in what language — INFRA-115.
 *
 * Both halves come from ONE row of `script-language.mjs`. They used to be two hand-written
 * constants in this file, and they disagreed: `dash`, `ksh` and `ash` were admitted by shebang with
 * no matching extension, so `scripts/sweep` was reported and `scripts/sweep.ksh` — same content —
 * was clean.
 */
const SCRIPTS = scriptFilters(['shell', 'javascript', 'typescript', 'python', 'yaml']);

/**
 * Python alone, for the import-binding rule (issue #1919). Derived from the same table as `SCRIPTS`,
 * so a python spelling added there governs here with no second list to keep in step.
 */
const PYTHON = scriptFilters(['python']);

/**
 * Files that DESCRIBE the hazardous spellings rather than run them. Every entry is the guard, its
 * test, or the record of why the rule exists — the three places the four spellings have to be
 * writable in full, or the rule cannot be explained to the person it stops.
 */
const ALLOWED_FILES = new Set([
  'scripts/harness/scan-symlink-following-enumeration.mjs',
  'scripts/harness/__tests__/scan-symlink-following-enumeration.test.mjs',
  'scripts/harness/__tests__/bulk-edit-guard.test.mjs',
  '.claude/hooks/bulk-edit-guard.sh',
  // INFRA-109's case table. It is a `.mjs` file, so it is read by the FALLBACK pattern rather than
  // by the shared shell reading, and the difference is visible here rather than argued: the shared
  // reading returns nothing for every row, because each spelling sits inside a quoted string and the
  // tokenizer knows that is data. The pattern cannot, and reported eleven rows — including
  // `['find without -L', "find packages -name '*.ts'", []]`, whose whole point is that it carries no
  // hazardous flag, matched by reading across the quotes into the expectation beside it.
  //
  // That is the strongest available evidence for the limit stated on `fallbackPattern`, and it is
  // why this entry is an allowlist line rather than a reason to widen the pattern.
  'scripts/harness/__tests__/flag-attribution.one-owner.test.mjs',
]);

/**
 * The population, delegated to `enumerate-files` — the single owner of "which files does a scan
 * judge" (INFRA-121).
 *
 * This scan used to call `git ls-files` itself. That was one of eight such copies, and the cost was
 * measured on this very change: a task document passed `reference-kind-qualified` before it was
 * staged and failed after, because an unstaged file is outside an index-read population. The owner
 * now includes `--others --exclude-standard`, so a file written and not yet staged is part of the
 * tree its author is asking about.
 *
 * The index remains the right SOURCE here for the reason the header gives — `git ls-files` cannot
 * return a `node_modules` path, and that is the property the whole rule rests on. What changed is
 * that the choice has an owner and reports what it enumerated, instead of being made privately here.
 */
function trackedFiles() {
  return enumerateFiles();
}

/**
 * Split one line into command SEGMENTS — the runs between `|`, `||`, `&`, `&&` and `;`.
 *
 * A flag belongs to the command that received it, and a line is not one command. Reported in the
 * review of this change against `bulk-edit-guard.sh` and true here for the same reason: matching
 * `rg …` and a later `-L` anywhere on the line flags `rg -l foo src | xargs grep -L bar`, where the
 * `-L` is grep's files-without-match and follows nothing. A scan that refuses correct scripts is one
 * that gets deleted, and unlike the hook this half has no ack to fall back on.
 *
 * STATED LIMIT, the same one the hook carries: a second command inside ONE segment inherits the
 * first's attribution, so `find … -exec grep -L {} \;` reads as `find` carrying `-L`. The pipeline is
 * the common shape and is separated; `-exec` is not.
 */
function segmentsOf(line) {
  return line.split(/\|\|?|&&?|;/);
}

/** A shell/JS line comment or a markdown-ish prose line is discussion, not an invocation. */
function isCommentary(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  );
}

/**
 * An extensionless file is a script if it SAYS SO.
 *
 * Gating the population on the extension list alone made this repository's own `.husky/pre-commit`,
 * `pre-push` and `commit-msg` — three of the fifty tracked extensionless files, and the only three
 * that are scripts — invisible to a rule whose text claims committed scripts unqualified.
 * `scan-shell-portability.mjs` had already replaced a list of directories with this same property in
 * review of #1590, and states the reason: a property of the file beats a list of places the property
 * is assumed to hold, because the list is what goes stale.
 *
 * Both halves of "is this a script, and in what language" come from `script-language.mjs`
 * (INFRA-115). A cut that added `ruby` and `perl` — which have no matching extension — judged the
 * same script when written without one and ignored it when written as `sweep.rb`: two filters inside
 * one file disagreeing about one population. Adding a language means adding both, which the table
 * now enforces rather than describes.
 */
/*
 * INFRA-115 discharged the containment note that stood here. `dash`, `ksh` and `ash` were listed as
 * interpreters with no matching entry in the extension set, and the paragraph above asserted the
 * opposite. Both halves now come from one table, so the sentence is a data structure and cannot
 * overstate again. Adding a language means adding both of its halves, which is what the table
 * refuses to let a caller skip.
 */

function isScannedScript(relativePath, content) {
  return SCRIPTS.isScript(relativePath, content);
}

/**
 * Every finding in one file.
 *
 * `attributeLine` is the SHARED reading — `(relativePath, lineNumber) => string[] | undefined`, the
 * hazard command names that line actually passes an option to, as
 * `.claude/hooks/lib/attribute-lines.sh` reports them. When it answers for a line, its answer is
 * used and no pattern is consulted: that is what makes the two enforcers one implementation rather
 * than two that happen to agree today.
 *
 * It is a PARAMETER rather than a call inside this function because attribution is batched — one
 * bash process for the whole run, not one per line — and because this function stays pure and
 * synchronous so a case can drive it against a fixture. `main()` supplies it; a caller that omits it
 * gets the fallback pattern, which is also what a non-shell file gets. (INFRA-109)
 */
export function findingsIn(relativePath, content, attributeLine = undefined) {
  if (ALLOWED_FILES.has(relativePath)) return [];
  if (!isScannedScript(relativePath, content)) return [];

  const rows = hazardRows();
  const findings = [];
  // Issue #1919: the names this file bound to the symlink-following function, if it is python. The
  // set is computed ONCE per file rather than per line, because an import binds for the whole file
  // and a per-line reading could only see the import's own line.
  const boundGlobs = PYTHON.isScript(relativePath, content) ? globBindingsIn(content) : new Set();
  const boundGlobCall = boundGlobs.size > 0 ? boundGlobCallPattern(boundGlobs) : null;
  const lines = content.split('\n');
  for (const [index, line] of lines.entries()) {
    if (isCommentary(line)) continue;
    const attributed = attributeLine?.(relativePath, index + 1);
    const segments = segmentsOf(line);
    for (const row of rows) {
      const hit =
        attributed === undefined
          ? segments.some((segment) => fallbackPattern(row).test(segment))
          : attributed.includes(row.id);
      if (!hit) continue;
      findings.push({
        file: relativePath,
        line: index + 1,
        id: row.id,
        remedy: row.remedy,
        text: line.trim(),
      });
    }
    for (const rule of CALL_RULES) {
      if (!segments.some((segment) => rule.pattern.test(segment))) continue;
      findings.push({
        file: relativePath,
        line: index + 1,
        id: rule.id,
        remedy: rule.remedy,
        text: line.trim(),
      });
    }
    // Issue #1919: the same function reached through an imported binding. Reported under its own id
    // so a reader can tell which spelling was found — the remedy is identical, the search is not.
    if (boundGlobCall && segments.some((segment) => boundGlobCall.test(segment))) {
      findings.push({
        file: relativePath,
        line: index + 1,
        id: 'python glob imported binding',
        remedy: 'use pathlib Path(...).rglob, which does not follow symlinks (measured)',
        text: line.trim(),
      });
    }
  }
  return findings;
}

let examinedScripts = 0;

/** How many tracked scripts the last run opened. The size the pass line reports. */
export function examinedScriptCount() {
  return examinedScripts;
}

/**
 * Every finding across `trackedPaths`, with the reader injectable so a case can be run against a
 * fixture of known size rather than against the tree.
 *
 * The counter is RESET here rather than incremented from wherever it stood. A size that accumulates
 * across runs reads as a growing subject, which is the one way a declared measurement can be wrong
 * while every finding it reports is right.
 *
 * THE READER TAKES TWO ARGUMENTS: `(file, optional)`. An optional read is one this scan makes only
 * to find out whether an extensionless file is a script at all, and the reader may answer `null` —
 * a tracked symlink to a directory is one of the things that answers no. A read that is NOT optional
 * is for a file the extension list already admitted, and the reader must refuse it rather than come
 * back empty-handed; this function throws if one does, because skipping there is the invisibility
 * the whole rule is about. A caller writing a reader reads this, not the loop below.
 */
export function scanTrackedFiles(trackedPaths, readFile, attributeLine = undefined) {
  examinedScripts = 0;
  const findings = [];
  for (const file of trackedPaths) {
    // The allowlist is applied HERE, before the counter, not only inside `findingsIn`. It used to be
    // inside alone, so the files that describe the spellings were opened, counted, and then returned
    // empty — the declared size and the judged population differing by a constant, which is what
    // `measurement-provenance.md` clause 1 is about and what this file's own case asserts.
    if (ALLOWED_FILES.has(file)) continue;
    const extension = extensionOf(file);
    if (!SCRIPTS.hasScriptExtension(file) && extension !== '') continue;
    // Strictness is decided HERE, where the extension is already known, rather than left to whatever
    // reader is injected. An extensionless file has to be READ to be classified, so only those fifty
    // are opened at all, and that read is the optional one: a tracked extensionless path that cannot
    // be read as text is one of the things "is this a script" answers no to (twelve symlinks to
    // directories under `.claude/skills/` are tracked, so it is routine rather than an exception).
    const optional = !SCRIPTS.hasScriptExtension(file);
    const content = readFile(file, optional);
    if (content === null || content === undefined) {
      if (!optional) {
        throw new Error(
          `symlink-following-enumeration: ${file} is in the population by its extension, but the ` +
            `reader returned no content for it. A strict read must refuse, not skip.`,
        );
      }
      continue;
    }
    if (!isScannedScript(file, content)) continue;
    examinedScripts += 1;
    findings.push(...findingsIn(file, content, attributeLine));
  }
  return findings;
}

/**
 * The SHARED reading, for the population where shell grammar is a reading of anything.
 *
 * Collects every candidate line out of the tracked SHELL scripts, hands them to
 * `.claude/hooks/lib/attribute-lines.sh` in ONE process, and returns a lookup the scan consults per
 * line. That script is the hook's own attribution, so a spelling this scan reports and a spelling
 * the hook refuses are decided by the same code rather than by two implementations that agree today.
 *
 * MEASURED before choosing the shape: 161 candidate lines across 27 shell scripts, ~1.1s for the
 * batch. A process per line would have been ~40s, and a scan that slow on the pre-push path is one
 * that gets moved off it. The cost is a number here rather than an assumption because the same
 * question — is a shared reader affordable — is what INFRA-110 has to answer for a PreToolUse hook,
 * where the answer may well be different.
 *
 * A NON-SHELL script gets no entry and falls back to the pattern. That is the honest limit: a `.mjs`
 * line calling `execSync` and a `.yml` `run:` block both hold shell inside another language, and
 * naming the language of an embedded payload is INFRA-123. 801 of the 962 candidate lines are in
 * that population, so this is most of the subject, not a corner of it.
 *
 * Returns `undefined` — meaning "use the fallback everywhere" — when the helper cannot be run at
 * all. It does NOT return an empty map: an empty map says "every line is clean", and a scan must not
 * report a pass over a population it could not read.
 */
function sharedAttribution(trackedPaths, readFile) {
  const shell = scriptFilters(['shell']);
  const candidates = [];
  const index = new Map();
  const mentionsAHazard = new RegExp(
    `\\b(${hazardRows()
      .map((row) => row.command)
      .join('|')})\\b`,
  );

  for (const file of trackedPaths) {
    if (ALLOWED_FILES.has(file)) continue;
    if (!SCRIPTS.hasScriptExtension(file) && extensionOf(file) !== '') continue;
    const content = readFile(file, !SCRIPTS.hasScriptExtension(file));
    if (content === null || content === undefined) continue;
    if (!shell.isScript(file, content)) continue;
    for (const [i, line] of content.split('\n').entries()) {
      if (isCommentary(line) || !mentionsAHazard.test(line)) continue;
      index.set(`${file}:${i + 1}`, candidates.length);
      candidates.push(line);
    }
  }

  const result = spawnSync('bash', [ATTRIBUTE_LINES, HAZARD_TABLE], {
    input: candidates.map((line) => `${line}\0`).join(''),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(
      `symlink-following-enumeration: could not run ${ATTRIBUTE_LINES} ` +
        `(${result.stderr?.trim() || result.error?.message || `exit ${result.status}`}). ` +
        'Falling back to pattern matching for every file, which is a WEAKER reading — reported ' +
        'rather than taken silently.',
    );
    return undefined;
  }

  const hits = new Map();
  for (const line of result.stdout.split('\n')) {
    if (!line) continue;
    const [slot, command] = line.split('\t');
    const key = Number(slot);
    if (!hits.has(key)) hits.set(key, []);
    hits.get(key).push(command);
  }

  return (file, lineNumber) => {
    const slot = index.get(`${file}:${lineNumber}`);
    if (slot === undefined) return undefined;
    return hits.get(slot) ?? [];
  };
}

function main() {
  const read = (file, optional = false) => {
    try {
      return readFileSync(path.join(WORKSPACE_ROOT, file), 'utf8');
    } catch {
      // A tracked path that cannot be read is reported, not skipped: silence here would be the same
      // invisibility the whole rule is about. `optional` is the one exception, and it is a
      // CLASSIFICATION rather than a skip — see the contract on `scanTrackedFiles`.
      if (optional) return null;
      console.error(`symlink-following-enumeration: could not read tracked file ${file}`);
      process.exit(1);
    }
  };

  const tracked = trackedFiles();
  const findings = scanTrackedFiles(tracked, read, sharedAttribution(tracked, read));

  console.log(`::examined:: ${examinedScriptCount()} tracked script(s)`);

  if (findings.length === 0) {
    console.log('symlink-following-enumeration scan passed.');
    return;
  }

  console.error('symlink-following-enumeration: committed scripts enumerate through symlinks.');
  console.error(
    'In a pnpm workspace that reaches node_modules and the store hard-linked beneath it,',
  );
  console.error('where a write is invisible to git and survives pnpm install.');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.id} — ${finding.remedy}`);
    console.error(`    ${finding.text}`);
  }
  console.error(
    'Prefer `git ls-files` as the source of a bulk edit: it cannot return a node_modules path.',
  );
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
