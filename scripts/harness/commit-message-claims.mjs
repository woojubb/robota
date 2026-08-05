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
 * Exit 0 = every checkable claim in the message resolves.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** A token shaped like an abbreviated or full object name. */
const COMMITISH = /\b([0-9a-f]{7,40})\b/g;

/** A code-spanned token shaped like a repository path. */
const CODE_SPAN = /`([^`\n]+)`/g;
const PATHISH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*\/[A-Za-z0-9._/-]+$/;

/**
 * Words that are hex-shaped but are not object names.
 *
 * `deadbeef`, `feedface` and friends appear in prose about fixtures. Kept short and literal: a list
 * that tried to be clever would start excusing real hashes.
 */
const NOT_A_HASH = new Set(['deadbeef', 'feedface', 'facefeed', 'baddcafe', 'deadbead']);

export function commitishClaims(message) {
  const found = new Set();
  COMMITISH.lastIndex = 0;
  let match;
  while ((match = COMMITISH.exec(message)) !== null) {
    const token = match[1];
    if (NOT_A_HASH.has(token)) continue;
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

export function checkCommitMessageFile(file, root = WORKSPACE_ROOT) {
  // Fail closed: a message file that cannot be read is not an empty message.
  if (!existsSync(file)) throw new Error(`commit-message-claims: ${file} does not exist.`);
  const message = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');

  const staged = new Set(gitLines(['diff', '--cached', '--name-only'], root));

  return judgeMessage(message, {
    resolvesObject: (token) => gitLines(['cat-file', '-t', token], root)[0] === 'commit',
    pathKnown: (token) => staged.has(token) || existsSync(path.join(root, token)),
  });
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('commit-message-claims: pass the path to the commit message file.');
    process.exitCode = 1;
    return;
  }

  const findings = checkCommitMessageFile(file);
  if (findings.length === 0) return;

  console.error(
    `commit-message-claims: ${findings.length} claim(s) in the message resolve to nothing:`,
  );
  for (const finding of findings)
    console.error(`  - [${finding.kind}] \`${finding.token}\` ${finding.detail}`);
  console.error(
    '\nRead the tree, then write the message. A message is what the next reader trusts instead of the diff.',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
