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
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Script trees whose contents this repo actually executes. */
const SCAN_ROOTS = ['scripts', '.husky', '.claude/hooks'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__tests__', 'fixtures']);
const EXTENSIONS = /\.(sh|bash|zsh)$/;
/** husky hooks and shell entry points are commonly extensionless. */
const EXTENSIONLESS_ROOTS = new Set(['.husky']);

const DIVERGENT = [
  {
    flag: 'sed -i',
    pattern: /(^|[;&|(`$\s])sed\s+(-[a-zA-Z]*\s+)*-i/,
    portable: 'rewrite the file with node/python3, or read + write explicitly',
  },
  {
    flag: 'readlink -f',
    pattern: /(^|[;&|(`$\s])readlink\s+(-[a-zA-Z]*\s+)*-f\b/,
    portable: 'node -e "console.log(require(\'fs\').realpathSync(p))"',
  },
  {
    flag: 'stat -c',
    pattern: /(^|[;&|(`$\s])stat\s+(-[a-zA-Z]*\s+)*-c\b/,
    portable: 'node -e with fs.statSync',
  },
  {
    flag: 'date -d',
    pattern: /(^|[;&|(`$\s])date\s+(-[a-zA-Z]*\s+)*(-d\b|--date\b)/,
    portable: 'node -e with Date arithmetic',
  },
  {
    flag: 'grep -P',
    pattern: /(^|[;&|(`$\s])grep\s+(-[a-zA-Z]*\s+)*(-P\b|--perl-regexp\b)/,
    portable: 'rg, or grep -E',
  },
  {
    flag: 'base64 -w',
    pattern: /(^|[;&|(`$\s])base64\s+(-[a-zA-Z]*\s+)*-w/,
    portable: 'base64 (macOS does not wrap) or node Buffer',
  },
  {
    flag: 'find -printf',
    pattern: /(^|[;&|(`$\s])find\s[^\n]*\s-printf\b/,
    portable: 'find -exec, or a node walk',
  },
  {
    flag: 'xargs -r',
    pattern: /(^|[;&|(`$\s])xargs\s+(-[a-zA-Z]*\s+)*-r\b/,
    portable: 'guard the empty case before the pipe',
  },
];

/** A line whose executable part is empty — the flag is being DISCUSSED, not run. */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('#') || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
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
      const topLevel = relDir.split(path.sep)[0];
      if (EXTENSIONS.test(entry.name) || EXTENSIONLESS_ROOTS.has(topLevel)) out.push(rel);
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
      const lines = readFileSync(path.join(root, rel), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isComment(lines[i])) continue;
        for (const { flag, pattern, portable } of DIVERGENT) {
          if (pattern.test(lines[i])) {
            findings.push({
              file: rel,
              line: i + 1,
              flag,
              portable,
              text: lines[i].trim().slice(0, 120),
            });
            break;
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
