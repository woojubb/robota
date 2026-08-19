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

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Each rule names the safe sibling, because a finding whose remedy is not stated is a finding people
 * work around. The `pattern` is deliberately shaped so the SAFE form does not match it.
 *
 * Every rule allows arbitrary words between the command and its flag, because a flag does not have to
 * come first: `find packages -name '*.ts' -L` follows symlinks exactly as `find -L packages` does, and
 * the first cut of `find` and `grep` required the flag to sit in the command's opening flag run, so
 * the trailing form was reported CLEAN while still reaching the store. Reported in review of this
 * change. What bounds the search is the SEGMENT — see `segmentsOf` — not the shape of the flag run.
 */
const RULES = [
  {
    id: 'find -L',
    pattern: /\bfind\s+(?:[^\s]+\s+)*?(?:-L|-follow)\b/,
    remedy: 'drop -L; plain find does not follow symlinks (measured)',
  },
  {
    id: 'grep -R',
    pattern: /\bgrep\s+(?:[^\s]+\s+)*?(?:-[a-zA-Z]*R[a-zA-Z]*\b|--dereference-recursive\b)/,
    remedy: 'use -r, which does not dereference symlinks (measured)',
  },
  {
    id: 'rg --follow',
    pattern: /\brg\s+(?:[^\s]+\s+)*?(?:--follow\b|-[a-zA-Z]*L[a-zA-Z]*\b)/,
    remedy: 'drop --follow; rg does not follow, and honours .gitignore',
  },
  {
    id: 'python glob.glob',
    pattern: /\bglob\.(?:glob|iglob)\s*\(/,
    remedy: 'use pathlib Path(...).rglob, which does not follow symlinks (measured)',
  },
];

const SCANNED_EXTENSIONS = new Set([
  '.sh',
  '.bash',
  '.zsh',
  '.mjs',
  '.cjs',
  '.js',
  '.ts',
  '.py',
  '.yml',
  '.yaml',
]);

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
]);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter((entry) => entry.length > 0);
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

export function findingsIn(relativePath, content) {
  if (ALLOWED_FILES.has(relativePath)) return [];
  if (!SCANNED_EXTENSIONS.has(path.extname(relativePath))) return [];

  const findings = [];
  const lines = content.split('\n');
  for (const [index, line] of lines.entries()) {
    if (isCommentary(line)) continue;
    const segments = segmentsOf(line);
    for (const rule of RULES) {
      if (!segments.some((segment) => rule.pattern.test(segment))) continue;
      findings.push({
        file: relativePath,
        line: index + 1,
        id: rule.id,
        remedy: rule.remedy,
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
 */
export function scanTrackedFiles(trackedPaths, readFile) {
  examinedScripts = 0;
  const findings = [];
  for (const file of trackedPaths) {
    if (!SCANNED_EXTENSIONS.has(path.extname(file))) continue;
    examinedScripts += 1;
    findings.push(...findingsIn(file, readFile(file)));
  }
  return findings;
}

function main() {
  const read = (file) => {
    try {
      return readFileSync(path.join(WORKSPACE_ROOT, file), 'utf8');
    } catch {
      // A tracked path that cannot be read is reported, not skipped: silence here would be the same
      // invisibility the whole rule is about.
      console.error(`symlink-following-enumeration: could not read tracked file ${file}`);
      process.exit(1);
    }
  };

  const findings = scanTrackedFiles(trackedFiles(), read);

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
