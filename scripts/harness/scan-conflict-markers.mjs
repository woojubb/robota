#!/usr/bin/env node

/**
 * Mechanizes the manual "Conflict Scan Commands" block in AGENTS.md (HARNESS-018).
 *
 * Scans the harness prose (AGENTS.md + .agents/skills + .agents/rules) for phrases
 * that, when used as *guidance*, contradict the repo's rules — e.g. advocating a
 * fallback/temporary workaround, or hierarchy-implying agent naming.
 *
 * Legitimate occurrences (the rules that PROHIBIT these terms, and the AGENTS.md
 * command block that defines this very scan) are skipped via an explicit, documented
 * allowlist. A new flagged line must either be reworded or added to ALLOW_SUBSTRINGS
 * with a reason.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

const PATTERNS = [
  /any\/unknown may|fallback to|temporary workaround/i,
  /main agent|sub-agent|parent-agent|child-agent/i,
];

// Lines containing any of these substrings are legitimate definitional/prohibitional
// uses, not advocacy. Keep this list small and documented.
const ALLOW_SUBSTRINGS = [
  'rg -n "', // the AGENTS.md "Conflict Scan Commands" definitions themselves
  'Prohibited:', // naming-style.md prohibition list of hierarchy terms
  'PATTERNS = [', // this scanner's own pattern definition (if ever scanned)
  'ALLOW_SUBSTRINGS', // this scanner's allowlist
];

const SCAN_TARGETS = ['AGENTS.md', '.agents/skills', '.agents/rules'];

function walkMarkdown(root, target) {
  const full = path.join(root, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return full.endsWith('.md') ? [full] : [];
  const files = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(root, path.join(target, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(full, entry.name));
    }
  }
  return files;
}

/**
 * Real git conflict debris — the thing everyone means by "conflict marker".
 *
 * HARNESS-052: this scan is registered as `conflict-markers` and, until now, checked only for
 * CONTRADICTORY GUIDANCE in three markdown trees. Falsified 2026-07-26 by appending a literal
 * `<<<<<<< HEAD` / `=======` / `>>>>>>> develop` block to `packages/agent-core/src/index.ts`: this
 * scan printed `conflict marker scan passed.`, and no other harness scan detects the pattern either.
 * A `✓ conflict-markers` line in the merge-gate summary was evidence for a check nobody performed.
 *
 * Rather than rename the scan (its registered name `conflict-markers` is the honest one for this
 * rule), the missing rule is added so the name becomes true.
 */
const GIT_CONFLICT_MARKER = /^(?:<{7}|={7}|>{7})(?:\s|$)/;

/** Source trees where merge debris would actually ship. */
const MARKER_SCAN_ROOTS = ['packages', 'apps', 'scripts'];
const MARKER_SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.turbo']);
const MARKER_EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|md|ya?ml)$/;

function walkSourceFiles(root, relDir, out) {
  const absolute = path.join(root, relDir);
  if (!existsSync(absolute)) return out;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (MARKER_SKIP_DIRS.has(entry.name)) continue;
      walkSourceFiles(root, path.join(relDir, entry.name), out);
    } else if (MARKER_EXTENSIONS.test(entry.name)) {
      out.push(path.join(relDir, entry.name));
    }
  }
  return out;
}

/** Literal git conflict debris left in a source tree. */
export function findGitConflictMarkers(root = WORKSPACE_ROOT) {
  const findings = [];
  const missing = MARKER_SCAN_ROOTS.filter((dir) => !existsSync(path.join(root, dir)));
  if (missing.length > 0)
    throw new Error(
      `governed tree(s) absent under ${root}: ${missing.join(', ')}. This scan will not report a ` +
        'pass over source it could not read.',
    );
  examinedSourceFiles = 0;
  for (const dir of MARKER_SCAN_ROOTS) {
    for (const rel of walkSourceFiles(root, dir, [])) {
      examinedSourceFiles++;
      const lines = readFileSync(path.join(root, rel), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (GIT_CONFLICT_MARKER.test(lines[i])) {
          findings.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 120) });
        }
      }
    }
  }
  return findings;
}

/**
 * How much the last run read — HARNESS-057. Module-level holders set where each walk happens and
 * read where the lines are printed, so the finders' return shapes (and every test that asserts on
 * their findings) stay untouched. Reset at the top of each walk, or a run that examined nothing
 * would report the previous run's number.
 *
 * TWO holders, because this scan has TWO subjects and they are different sizes: the conflict-debris
 * walk reads source across `packages`/`apps`/`scripts`, while the forbidden-phrase walk reads only
 * the governance markdown. The first version of this line counted the markdown alone and printed it
 * as the whole subject — under-reporting the larger walk by an order of magnitude, which is the very
 * defect this marker exists to expose ("the number must come from the walk"). Review caught it.
 */
let examinedDocuments = 0;
let examinedSourceFiles = 0;

/** What the last `findConflictMarkerFindings` run actually read — exported so it can be asserted. */
export function examinedDocumentCount() {
  return examinedDocuments;
}

/** What the last `findGitConflictMarkers` walk actually read — exported so it can be asserted. */
export function examinedSourceFileCount() {
  return examinedSourceFiles;
}

export function findConflictMarkerFindings(root = WORKSPACE_ROOT) {
  examinedDocuments = 0;
  const findings = findGitConflictMarkers(root);
  for (const target of SCAN_TARGETS) {
    for (const file of walkMarkdown(root, target)) {
      examinedDocuments++;
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (ALLOW_SUBSTRINGS.some((allow) => line.includes(allow))) continue;
        for (const pattern of PATTERNS) {
          if (pattern.test(line)) {
            findings.push({
              file: path.relative(root, file),
              line: i + 1,
              text: line.trim().slice(0, 120),
            });
            break;
          }
        }
      }
    }
  }
  return findings;
}

export function main() {
  const findings = findConflictMarkerFindings();
  if (findings.length === 0) {
    // HARNESS-057: the size of the subject, on the channel the runner reads — ONE LINE PER SUBJECT,
    // because this scan walks two of them and a single number would have to misreport one. A zero in
    // either means that walk found nothing, which is a pass over nothing rather than a clean tree, so
    // neither carries an expected-empty excuse and the runner fails the suite on it.
    process.stdout.write(`::examined:: ${examinedSourceFiles} source files\n`);
    process.stdout.write(`::examined:: ${examinedDocuments} governance documents\n`);
    process.stdout.write('conflict marker scan passed.\n');
  } else {
    process.stdout.write('conflict marker scan failed:\n');
    for (const f of findings) {
      process.stdout.write(`  ${f.file}:${f.line}  ${f.text}\n`);
    }
    process.stdout.write(
      '\nReword the guidance, or (if a legitimate definition/prohibition) add a substring to ALLOW_SUBSTRINGS.\n',
    );
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
