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

import { hasStem } from './lib/file-name-shape.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

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
 */
// A WHOLE token, not a window inside one. `\b` alone let a 7-char run be found inside a longer
// identifier — `build0aded1234567890` contains one — so an ordinary word could be read as a
// citation. The token is bounded by something that is not an identifier character on both sides,
// which is what "a hash written on its own" actually looks like.
const COMMITISH =
  /(?<![0-9a-zA-Z_-])(?=[0-9a-f]{7,40}(?![0-9a-zA-Z_-]))[a-f]*[0-9][0-9a-f]*(?![0-9a-zA-Z_-])/g;

/** A code-spanned token shaped like a repository path. */
const CODE_SPAN = /`([^`\n]+)`/g;
// A slash is not what makes a token a path. `AGENTS.md` and `commitlint.config.js` are cited in
// commit messages constantly and went unchecked — the same false claim this file exists to catch,
// one directory level up. A token with a file extension is a claim about a file wherever it sits.
const PATHISH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*(\/[A-Za-z0-9._/-]+|\.[A-Za-z0-9]+)$/;

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
    // A pure-digit run is a number — a count, a year, an issue — not an object name.
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
    // A form, not a path.
    if (/[<>*?{}]/.test(token)) continue;
    // A SHAPE, not a name. `.test.ts` and `.d.ts` are what a file ends with, and a commit message
    // explaining a convention names them constantly — measured on this repository's own CI, which
    // refused the commit that shipped the first half of this rule. Shared with the named-artifact
    // scan so the two cannot answer differently.
    if (!hasStem(token)) continue;
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

function gitLines(args, cwd = WORKSPACE_ROOT) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
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
  return gitLines(['log', '--all', '--oneline', '-1', '--', token], root).length > 0;
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
  if (gitLines(['cat-file', '-t', token], root).length > 0) return true;
  if (gitLines(['rev-parse', '--disambiguate=' + token], root).length > 0) return true;
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
  return gitLines(['rev-parse', '--is-shallow-repository'], root)[0] === 'true';
}
