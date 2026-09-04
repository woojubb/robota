#!/usr/bin/env node

/**
 * A commit message describes the DIFF, not the intent.
 *
 * ## The class
 *
 * Twice in one session a commit message asserted something that had not happened: once a message
 * said an edit had been recorded in a document while the edit's own script had failed its assertion
 * and written nothing, and once a reply cited a commit hash that was typed rather than read. Both
 * were found by someone else, and both had the same shape — **the message was written from what the
 * author meant to do, not from what the tree now contains.**
 *
 * That is worse than an ordinary error. A message is the record the next reader trusts INSTEAD of
 * reading the diff, so a false one does not merely fail to inform: it substitutes for looking.
 *
 * ## The decidable slice
 *
 * Two claims a machine can check without judging the prose:
 *
 *  - **a commit-ish token** — `[0-9a-f]{7,40}` — must resolve to an object in this repository;
 *  - **a repository path** in a code span must exist in the tree, or be touched by this very commit.
 *
 * The second is the one that catches "the item now records X" when the item was never edited: the
 * path is named, the tree has it, but the commit does not touch it. Naming a file you did not change
 * is legitimate (context, a pointer), so this only fires when the path exists NOWHERE — neither in
 * the tree nor in the change — which is the state that cannot be anything but wrong.
 *
 * Deliberately NOT checked: whether the prose is true. That is the general problem, and it is not
 * this file's.
 *
 * ## No command-line entry
 *
 * `commitlint.config.js` imports `judgeMessage` and `pathHasEverExisted` directly, so a `main()`
 * here would be a second way to run the same judgement — and the one nothing calls. Review found
 * exactly that: a file-reading entry point and a CLI wrapper that no hook, no workflow and no test
 * invoked. An entry point nothing calls is the reachability defect this repository measures; it is
 * removed rather than wired, because the wiring already exists elsewhere.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { EXTENSIONS, hasStem, isTemplateSlot } from './lib/file-name-shape.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/**
 * A token shaped like an abbreviated or full object name.
 *
 * The DIGIT is the whole difference between a hash and a word. Without it this matched any lowercase
 * run built from a-f — `defaced`, `acceded`, `effaced` — so an ordinary sentence would have been
 * refused for citing a commit it never mentioned. That is a guard firing on correct work, and it is
 * the failure that gets a guard turned off.
 *
 * Scoping to code spans was the other candidate and it costs more than it saves: the citation that
 * started this — a hash typed rather than read — was written in running prose, so a matcher that
 * only reads code spans would have missed the very incident it exists for. A hash with no digit at
 * all is possible and goes unchecked; that is a miss, and a miss is the cheaper error here.
 *
 * This is a REQUIRED status check, so a token it reads as a citation and cannot resolve REFUSES an
 * otherwise correct commit — the expensive direction. Review asked what else gets read that way,
 * and the answer was measured over this repository's last 3000 messages, through this module rather
 * than through the pattern alone: 51 tokens matched, 40 resolved, and 11 occurrences refused a
 * message that had cited nothing.
 *
 * The LENGTH set removes four of them. 7–12 characters or the full 40 is how a person cites a
 * commit; 32 is an MD5 and 64 a SHA-256, and both appear in messages as checksums —
 * `c7597884fdba1815ca9319c967d909e2` was one. After it: 47 matched, the same 40 resolved, 7
 * occurrences left, all of them short-hash-shaped tokens that genuinely resolve to nothing in this
 * clone. That last kind is the refusal this rule is for.
 *
 * The LETTER requirement moves an exclusion that already existed — a post-filter dropping all-digit
 * tokens — into the pattern, so the shape is described in one place instead of asserted in two. It
 * matters: a GitHub Actions run id like `30195049439` is all digits and is the single most common
 * hash-shaped token in these messages, while a 7-digit all-numeric SHA-1 prefix has odds of about
 * one in 270 million.
 */
// A WHOLE token, not a window inside one. `\b` alone let a 7-char run be found inside a longer
// identifier — `build0aded1234567890` contains one — so an ordinary word could be read as a
// citation. The token is bounded by something that is not an identifier character on both sides,
// which is what "a hash written on its own" actually looks like.
//
// `-` IS an identifier character here, deliberately, and review asked whether it should be: it
// means `abc1234-followup` is not read as a citation at all, a silent miss. It is the cheaper error.
// Dropping `-` would admit the hyphenated hash-like fragment that build output is full of —
// `index-a1b2c3d4.js` (allow-missing-artifact: an invented bundle name, which is the shape being
// described) — and a message naming a bundle would be refused for citing a commit nobody mentioned.
// A miss costs an unchecked citation; that costs a correct commit.
const COMMITISH =
  /(?<![0-9a-zA-Z_-])(?=(?:[0-9a-f]{7,12}|[0-9a-f]{40})(?![0-9a-zA-Z_-]))(?=[0-9a-f]*[a-f])[a-f]*[0-9][0-9a-f]*(?![0-9a-zA-Z_-])/g;

/** A code-spanned token shaped like a repository path. */
const CODE_SPAN = /`([^`\n]+)`/g;
// A slash is not what makes a token a path. `AGENTS.md` and `commitlint.config.js` are cited in
// commit messages constantly and went unchecked — the same false claim this file exists to catch,
// one directory level up. A token with a file extension is a claim about a file wherever it sits.
//
// A SINGLE-SEGMENT dotfile — `.gitignore`, `.npmrc` — is NOT matched, and that is measured rather
// than overlooked. Review reported them as excluded by `hasStem`; `hasStem` never saw them, because
// this pattern rejects them first. Widening it was tried and reverted: `.git`, `.agents`, `.husky`
// and `.turbo` are DIRECTORIES and `.length` is a PROPERTY, all written in backticks constantly,
// and admitting the shape refused correct documents. The coverage gap is real and is filed rather
// than closed by making the check noisier. See HARNESS-078.
//
// A SLASHLESS token must end in a KNOWN extension, and that is a false-positive fix this rule found
// by refusing its own commit. `path.relative` is an API call, not a file, and the loose spelling
// `\.[A-Za-z0-9]+` read it as one — as it would `path.join`, `fs.existsSync`, `Object.keys`, which
// commit messages about JavaScript are made of. A token WITH a slash keeps the loose rule: a slash
// says "path" on its own, and an unknown extension there should still be checked.
//
// This narrows in the direction the rule can afford. A slashless file whose extension is missing
// from the list goes unchecked — a silent pass — but the list is the same one
// `scripts/harness/lib/file-name-shape.mjs` owns for the artifact scan, so a gap is one edit in one
// place. Refusing every dotted identifier is the alternative, and it is the shape that gets a
// required check turned off.
const PATHISH = new RegExp(
  String.raw`^([A-Za-z0-9._][A-Za-z0-9._/-]*\/[A-Za-z0-9._/-]+|[A-Za-z0-9._][A-Za-z0-9._-]*\.(?:${EXTENSIONS.join('|')}))$`,
);

/**
 * Blank out the code spans this message already claims as PATHS.
 *
 * A file whose STEM is hex-shaped was read twice — correctly as a path, and again as a commit naming
 * nothing — so `fix: rename \`c0ffee1.mjs\`` was refused on a REQUIRED check for a hash it never
 * wrote. That is the guard firing on correct work, which is what gets a guard turned off.
 *
 * Only the spans `pathClaims` accepted are blanked, not every code span. A hash in backticks is the
 * ordinary way to write a citation, and excluding code spans wholesale would blind this to the very
 * thing it exists for. Blanked to SPACES rather than removed, so every remaining match keeps its
 * offsets and its word boundaries.
 */
function withoutPathSpans(message) {
  const paths = new Set(pathClaims(message));
  if (paths.size === 0) return message;
  return message.replace(CODE_SPAN, (span, inner) =>
    paths.has(inner.trim()) ? ' '.repeat(span.length) : span,
  );
}

export function commitishClaims(message) {
  const found = new Set();
  const scanned = withoutPathSpans(message);
  COMMITISH.lastIndex = 0;
  let match;
  while ((match = COMMITISH.exec(scanned)) !== null) {
    const token = match[0];
    // A pure-digit run is a number — a count, a year, an issue — not an object name. The pattern
    // above now requires a hex letter, so this is a second expression of the same rule; it stays as
    // the assertion that it holds, and would catch a pattern edit that dropped it.
    if (/^[0-9]+$/.test(token)) continue;
    found.add(token);
  }
  return [...found];
}

export function pathClaims(message) {
  const found = new Set();
  CODE_SPAN.lastIndex = 0;
  let match;
  while ((match = CODE_SPAN.exec(message)) !== null) {
    const token = match[1].trim();
    if (!PATHISH.test(token)) continue;
    // A SHAPE, not a name. `.test.ts` and `.d.ts` are what a file ends with, and a commit message
    // explaining a convention names them constantly — measured on this repository's own CI, which
    // refused the commit that shipped the first half of this rule. Shared with the named-artifact
    // scan so the two cannot answer differently.
    if (!hasStem(token)) continue;
    // A template slot is a FORM being explained, not a file being cited. Review supplied the live
    // case: `ADR-NNN-short-title.md` — the naming convention string a skill documents — passes
    // PATHISH and hasStem, and a commit message explaining that convention was a refusal on a
    // required check. The sibling named-artifact scan already excluded slots; this one did not,
    // which is the answered-differently fork the shared lib exists to prevent.
    if (isTemplateSlot(token)) continue;
    found.add(token);
  }
  return [...found];
}

/**
 * Judge one message.
 *
 * `resolvesObject` and `pathKnown` are injected so a case can describe a repository without one.
 */
export function judgeMessage(message, { resolvesObject, pathKnown }) {
  const findings = [];

  for (const token of commitishClaims(message)) {
    if (!resolvesObject(token)) {
      findings.push({
        kind: 'commitish-names-nothing',
        token,
        detail:
          'is shaped like a commit but names no object in this repository. A hash that was typed ' +
          'rather than read is a citation the next reader cannot follow.',
      });
    }
  }

  for (const token of pathClaims(message)) {
    if (!pathKnown(token)) {
      findings.push({
        kind: 'path-names-nothing',
        token,
        detail:
          'is named as a repository path and exists neither in the tree nor in this commit. ' +
          'Describe the diff, not the intent.',
      });
    }
  }

  return findings;
}

/**
 * Thrown when git could not RUN, as opposed to running and answering "no".
 *
 * The difference decides the verdict. `cat-file -t` exiting non-zero is a real answer — there is no
 * such object — and refusing the message is correct. Git being absent, or the repository being
 * unreadable, is not an answer at all, and reading it as absence refuses a perfectly good citation
 * on a REQUIRED check: the guard firing on correct work, which is what gets a guard turned off.
 */
class GitUnavailableError extends Error {}

function gitLines(args, cwd = WORKSPACE_ROOT) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch (error) {
    // A non-zero EXIT is git answering. Anything else — the binary missing, the process killed —
    // means it never got to answer, and this must not pass that off as a finding.
    const status = /** @type {{ status?: number }} */ (error).status;
    if (typeof status === 'number') return [];
    throw new GitUnavailableError(
      `git could not run (${args[0]}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Run a git question, treating an outage as UNABLE TO ANSWER rather than as a negative answer. */
function gitAnswered(args, { onUnavailable, cwd = WORKSPACE_ROOT }) {
  try {
    return gitLines(args, cwd);
  } catch (error) {
    if (!(error instanceof GitUnavailableError)) throw error;
    process.stderr.write(`commit-message-claims: ${error.message}\n`);
    return onUnavailable;
  }
}

/**
 * The paths staged for the commit being written, or an empty set when git cannot say.
 *
 * Exported so `commitlint.config.js` stops keeping its own `gitLines` — review found that copy
 * swallowing every git failure into `[]`, which is the distinction this file was written to make:
 * "git could not answer" is not "git answered no". Both callers now go through `gitAnswered`, which
 * says so on stderr and hands back the empty set only after that has been recorded.
 *
 * An empty set is the right VALUE either way — `pathHasEverExisted` still asks history and the
 * working tree, so nothing is decided on this alone.
 */
export function stagedPaths() {
  return new Set(gitAnswered(['diff', '--cached', '--name-only'], { onUnavailable: [] }));
}

/**
 * Does this token stay inside the repository once resolved?
 *
 * `path.relative` rather than a string prefix: a prefix test says `/repo-evil` is inside `/repo`,
 * and `..` at the front is the only thing that means "left the tree". An absolute token resolves to
 * itself and is caught by the same test.
 */
function isInsideRoot(root, token) {
  const relative = path.relative(path.resolve(root), path.resolve(root, token));
  // `'..' + path.sep`, not a bare `startsWith('..')` — review: a real name that merely BEGINS with
  // two dots (`..gitkeep`) never left the tree, and reading it as escaped would have this REQUIRED
  // check refuse a correct commit. No such name exists here today; the direction is what matters.
  const escaped = relative === '..' || relative.startsWith(`..${path.sep}`);
  return relative !== '' && !escaped && !path.isAbsolute(relative);
}

/**
 * Whether a named path has EVER existed — staged now, present now, or anywhere in history.
 *
 * "Present now" alone was wrong, and review found it in the place that matters: continuous
 * integration lints each commit of a pull request by piping `git log -1 --format=%B <sha>` into
 * commitlint WITHOUT checking that commit out. The working tree stays at HEAD for every message, so
 * `--cached` is empty and `existsSync` answers about the wrong tree — a message that correctly named
 * a file its own commit added would fail once a later commit renamed it, and one that named a file
 * only a LATER commit created would pass.
 *
 * History is the state that does not depend on which commit is checked out. It is also the honest
 * bound on what this can decide: whether the named path belongs to THIS commit's tree cannot be
 * answered from the message alone, since commitlint is handed text and never the sha.
 */
export function pathHasEverExisted(
  token,
  { staged, root = WORKSPACE_ROOT, isShallowOverride } = {},
) {
  if (staged?.has(token)) return true;
  // A token that escapes the repository is not a repository path, and asking the filesystem about
  // it is worse than useless. Review found `../../../etc/hosts.conf` reaching `existsSync` — its
  // last segment has an extension shape, so `PATHISH` and `hasStem` both pass it — which made a
  // commit message a file-existence oracle for paths OUTSIDE the checkout, and let a citation
  // "resolve" against a file this repository does not contain.
  //
  // Refused rather than probed: the answer to "does this repository contain `../../etc/passwd`" is
  // no, whatever the host filesystem happens to hold, so the claim is reported like any other that
  // names nothing here.
  if (!isInsideRoot(root, token)) return false;
  if (existsSync(path.join(root, token))) return true;
  // A SHALLOW clone has no history to search, so "no commit touched this path" would mean "the
  // history is not here" — and refusing a correct citation for that is a guard firing on correct
  // work, in a REQUIRED check. Unknown is not absent: where the log cannot answer, this does not
  // pretend it did.
  // A shallow clone cannot answer, and this says so on stderr rather than passing quietly. The
  // check still does not REFUSE — refusing a correct citation because the history was not fetched
  // is a guard firing on correct work, in a required check — but a reader looking at a green run
  // deserves to know a question went unasked.
  if (isShallowOverride ?? isShallow(root)) {
    process.stderr.write(
      `commit-message-claims: shallow clone — cannot verify that \`${token}\` has ever existed.\n`,
    );
    return true;
  }
  return (
    gitAnswered(['log', '--all', '--oneline', '-1', '--', token], {
      onUnavailable: ['unavailable'],
      cwd: root,
    }).length > 0
  );
}

/**
 * Whether a cited object is one this repository can be said to know.
 *
 * The path check above already treats a shallow clone as unable to answer rather than as an answer,
 * and an object citation is the same question about the same missing history. A shallow clone holds
 * a handful of recent commits, so a message correctly citing an OLDER commit names an object the
 * checkout genuinely does not have — and refusing it would be this guard firing on correct work in a
 * REQUIRED check, which is the failure direction a required check must not have.
 *
 * Living next to `pathHasEverExisted` is the point. The two tolerances were written apart once
 * before, in this same file's neighbourhood, and drifted; one function per question, used by every
 * caller, is what keeps them from disagreeing again.
 *
 * AMBIGUOUS is not ABSENT either: `cat-file -t` also exits non-zero when a short prefix matches
 * several objects, which a repository grows into as it accumulates commits, so `--disambiguate`
 * settles it — a prefix matching MORE than one thing resolves rather than being refused for naming
 * nothing.
 */
export function objectIsKnown(token, { root = WORKSPACE_ROOT, isShallowOverride } = {}) {
  // `['unavailable']` is a non-empty stand-in: git could not answer, so this does not refuse.
  const unavailable = { onUnavailable: ['unavailable'], cwd: root };
  if (gitAnswered(['cat-file', '-t', token], unavailable).length > 0) return true;
  if (gitAnswered(['rev-parse', '--disambiguate=' + token], unavailable).length > 0) return true;
  if (isShallowOverride ?? isShallow(root)) {
    process.stderr.write(
      `commit-message-claims: shallow clone — cannot verify that \`${token}\` names an object.\n`,
    );
    return true;
  }
  return false;
}

/** Whether the checkout has a truncated history, in which case the log cannot answer. */
export function isShallow(root = WORKSPACE_ROOT) {
  // Through `gitAnswered`, like every other git call in this file. `gitLines` THROWS
  // `GitUnavailableError` when git could not run at all, and this was the one caller that did not
  // catch it — so on a machine without git the whole check died with a stack trace instead of the
  // graceful degradation the two calls beside it already have. Review found it.
  //
  // `true` when git cannot answer, because that is the CONSERVATIVE reading here: shallow means
  // "history cannot be searched", and a host where git will not run cannot search history either.
  // The caller's shallow branch then reports on stderr and does not refuse, which is the behaviour
  // this whole path exists to provide.
  return (
    gitAnswered(['rev-parse', '--is-shallow-repository'], {
      onUnavailable: ['true'],
      cwd: root,
    })[0] === 'true'
  );
}
