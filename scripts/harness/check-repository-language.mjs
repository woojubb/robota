#!/usr/bin/env node

/**
 * Two rules about the text of tracked files, so AGENTS.md holds without depending on review.
 * The repository is global: everything in it is English, and Korean text lives only in localization
 * data. And code, tests and messages carry no tracker references (backlog IDs, issue or PR numbers,
 * stage labels): the tracker and git hold the history, a comment states the invariant.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isEntryPoint } from './entrypoint.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

/** Hangul jamo, compatibility jamo and syllables. */
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u;

/**
 * Where Korean may appear: localization data only. Message catalogs and locale data files
 * (`messages/…/ko.json`, `locales/ko.json`), localized documents (`content/ko/`, the Korean blog posts,
 * `docs/README-KO.md`) and test data (`__fixtures__/*.json`) that must carry Korean input.
 */
export const LOCALIZATION_DATA = Object.freeze([
  /(^|\/)messages\/(?:[^/]+\/)*ko\.json$/u,
  /(^|\/)locales\/ko\.json$/u,
  /^content\/ko\//u,
  /^apps\/blog\/src\/content\/blog\/ko\//u,
  /(^|\/)docs\/README-KO\.md$/u,
  /(^|\/)__fixtures__\/(?:[^/]+\/)*[^/]+\.json$/u,
]);

export function isLocalizationData(file) {
  return LOCALIZATION_DATA.some((pattern) => pattern.test(file));
}

/**
 * Every line holding Hangul in a file that is not localization data, as `{ file, line, text }`.
 * `read` returns a file's text, or `undefined` for one that is not text.
 */
export function findLanguageViolations(files, read) {
  const violations = [];
  for (const file of files) {
    if (isLocalizationData(file)) continue;
    const text = read(file);
    if (text === undefined) continue;
    text.split('\n').forEach((content, index) => {
      if (HANGUL.test(content)) violations.push({ file, line: index + 1, text: content.trim() });
    });
  }
  return violations;
}

/** Where tracker references are checked, and the files that quote them as data on purpose. */
const TRACKER_SCOPE = /^(?:packages|apps|scripts|examples|\.github)\//u;
const TRACKER_DATA = Object.freeze([
  /(?:^|\/)CHANGELOG\.md$/u,
  /\.(?:record\.json|jsonl)$/u,
  /^scripts\/release\/__tests__\/generate-release-notes\.test\.mjs$/u,
]);

/**
 * Prefixes of standards and of user-content test data; any other upper-case prefix followed by
 * digits is a backlog ID. A standard this rejects belongs here, not reworded.
 */
const NOT_BACKLOG = new Set([
  ...['SHA', 'HMAC-SHA', 'SHA3', 'BLAKE2', 'UTF', 'ISO', 'SLIP', 'CWE', 'CVE', 'ECMA', 'ECDSA'],
  ...['AES', 'RSA', 'RSA-OAEP', 'EC', 'PKCS', 'FIPS', 'CRC', 'TLS', 'RFC', 'OWASP', 'ES', 'SP'],
  ...['JSON-RPC', 'CLI-BL'],
]);
const BACKLOG_ID =
  /(?<![\w/.])((?:[A-Z][A-Z0-9]*-)*[A-Z][A-Z0-9]{1,20})-[A-Z]?\d{2,4}[a-z]?(?![\w-])/gu;
/** The backlog prefixes this repository used, in any case and spelling: `-NN`, `_NN` or glued `NN`. */
const KNOWN_ID =
  /(?<![a-z])(?:arch|sec|tc|cli|mcp|screen|selfhost|observability)[-_]?\d{2,4}(?!\d)/iu;
const ISSUE_REFERENCE =
  /\b(?:[Ii]ssues?|[Pp][Rr]s?|pull|[Ff]ix(?:es)?|[Cc]loses?|[Rr]esolves?) ?#\d+\b|(?<=^|[\s(,[])#[1-9]\d{3}(?![\w-])/u;
const STAGE_LABEL = /\b[Ss]tage[- ][A-E]\d?\b|\bstage-[a-e]\b|\bwork unit \d+\b|§\s?\d{3,4}\b/u;

/** Every file name and line of code, tests or scripts holding a tracker reference. */
export function findTrackerReferences(files, read) {
  const violations = [];
  for (const file of files) {
    if (!TRACKER_SCOPE.test(file)) continue;
    if (KNOWN_ID.test(file))
      violations.push({ file, line: 1, text: 'the file name carries an ID' });
    if (TRACKER_DATA.some((pattern) => pattern.test(file))) continue;
    const text = read(file);
    if (text === undefined) continue;
    text.split('\n').forEach((content, index) => {
      const backlog = [...content.matchAll(BACKLOG_ID)].some(
        ([, prefix]) => !NOT_BACKLOG.has(prefix),
      );
      if (backlog || [KNOWN_ID, ISSUE_REFERENCE, STAGE_LABEL].some((rule) => rule.test(content))) {
        violations.push({ file, line: index + 1, text: content.trim() });
      }
    });
  }
  return violations;
}

function readText(root, file) {
  const bytes = readFileSync(path.join(root, file));
  // A NUL byte marks a binary file; it has no prose to check.
  if (bytes.includes(0)) return undefined;
  return bytes.toString('utf8');
}

function main() {
  const root = resolveWorkspaceRoot(import.meta);
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const read = (file) => {
    try {
      return readText(root, file);
    } catch {
      // allow-fallback: a tracked path deleted in the working tree has nothing to check
      return undefined;
    }
  };
  const rules = [
    [
      findLanguageViolations(files, read),
      'contain Korean outside localization data. Write code, comments and documentation in English, ' +
        'and move user-facing Korean text into a localization data file (see AGENTS.md).',
    ],
    [
      findTrackerReferences(files, read),
      'carry a tracker reference (backlog ID, issue or PR number, stage label). State the reason ' +
        'in the comment, title or message instead; the tracker and git hold the history.',
    ],
  ];
  for (const [violations, advice] of rules) {
    for (const { file, line, text } of violations)
      console.error(`${file}:${line}: ${text.slice(0, 160)}`);
    if (violations.length > 0) {
      console.error(`\nrepository text: ${violations.length} line(s) ${advice}`);
      process.exitCode = 1;
    }
  }
  if (process.exitCode !== 1) {
    console.log(
      `repository text: ${files.length} tracked files checked, no Korean outside localization data, no tracker references`,
    );
  }
}

if (isEntryPoint(import.meta)) main();
