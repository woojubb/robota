#!/usr/bin/env node

/**
 * The repository is global: everything in it is English, and Korean text lives only in localization
 * data. This check fails when a tracked file outside that data contains Hangul, so the rule in
 * AGENTS.md holds without depending on review.
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
  const violations = findLanguageViolations(files, (file) => {
    try {
      return readText(root, file);
    } catch {
      // allow-fallback: a tracked path deleted in the working tree has nothing to check
      return undefined;
    }
  });
  if (violations.length === 0) {
    console.log(`repository language: ${files.length} tracked files checked, no Korean outside localization data`);
    return;
  }
  for (const { file, line, text } of violations) console.error(`${file}:${line}: ${text.slice(0, 160)}`);
  console.error(
    `\nrepository language: ${violations.length} line(s) contain Korean outside localization data. ` +
      'Write code, comments and documentation in English, and move user-facing Korean text into a ' +
      'localization data file (see AGENTS.md).',
  );
  process.exitCode = 1;
}

if (isEntryPoint(import.meta)) main();
