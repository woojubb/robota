#!/usr/bin/env node

/**
 * A `pnpm --filter` must name a package that declares the script after it.
 *
 * ## The defect, measured
 *
 * Issue #2660. `packages/agent-transport-tui/vitest.pty.config.ts` told its reader to run the PTY
 * suite with a filter naming `@robota-sdk/agent-transport` — a real workspace package that declares
 * no `test:pty` script. The package owning both that script and the 14 `*.ptytest.ts` files is
 * `@robota-sdk/agent-transport-tui`. Following the comment selected one real package, found nothing
 * to run, and the empty outcome read as a pass: `enforcement-architecture.md`'s "silence is not
 * success", reached through a command that looks entirely well-formed.
 *
 * The comment was correct when written. The config file was created under `packages/agent-transport/`
 * (CLI-074, `749a853517`) and MOVED to `packages/agent-transport-tui/` by the per-concern split
 * (`7a4fbcc2f4`) two days later. The split moved the file and left the filter naming the package it
 * came from. That is the class this guard covers — a package boundary moving out from under a
 * command someone wrote down — not an author's typo, which is why fixing the one line does not close
 * it.
 *
 * ## Why the two existing filter guards do not cover it
 *
 * `check-workspace-refs` and `check-ghost-package-refs` both ask whether the package NAME resolves.
 * Here it did: `agent-transport` is a real package, so both were satisfied while the command was
 * useless. The wrong half was the SCRIPT, and nothing related a filter to it.
 *
 * ## What is reported, and what deliberately is not
 *
 * REPORTED — exactly one condition: the filtered package resolves in this workspace AND its
 * `package.json` does not declare the script named after it.
 *
 * NOT REPORTED — a filter token that does not resolve to any workspace package. That question
 * already has two owners (above), and a third would be a second answer to one fact. It is also the
 * noisier half by two orders of magnitude: measured on `develop` when this landed, the corpus
 * carried 350 unresolvable occurrences over 74 distinct tokens, nearly all deliberate — `<pkg>`
 * placeholders, `./packages/**` path filters, `@robota-sdk/dag-*` globs, `!`-negations and fixture
 * names inside the harness's own tests. A guard that reported those would be silenced within a
 * week, and silencing it would take this condition down with it.
 *
 * ## The skip rules, each because guessing would be a false accusation
 *
 * How a command line is READ — pnpm sub-commands that are not scripts, `run <script>`, tokens that
 * are not script-shaped, selectors — is owned by `lib/pnpm-invocation.mjs`, which states which way
 * its own enumeration fails. Two more live here because they are about the CORPUS, not the syntax:
 *
 *  - an IMMUTABLE HISTORICAL RECORD, on exactly the grounds `check-ghost-package-refs` already
 *    excludes the same trees, via the predicate this module imports rather than copies. A command
 *    that was correct when the record was written is history: CLI-074's spec document names the
 *    pre-split filter three times and every one of them ran green on 2026-06-12. Rewriting them to
 *    satisfy a scan would falsify an accurate evidence record, which is a worse defect than the one
 *    being guarded.
 *  - `allow-undeclared-script: <reason>` on the occurrence's own line, reason required. A document
 *    whose SUBJECT is a wrong command has to be able to quote it — the spec document and Task record
 *    for this very item each state the defective filter as the symptom, and without the hatch this
 *    guard would make its own problem statement unwritable. The reason is read with `[ \t]`, never
 *    `\s`, so an empty marker cannot swallow the next line and excuse it
 *    (`scan-named-artifact-resolves` fixed that same defect twice; this is the shape that survived).
 *    Any comment syntax carries it — `<!-- … -->` in markdown, `//` or a JSDoc line in TypeScript.
 *
 * Exit code 0 = every filtered package declares the script named after it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isImmutableHistoricalRecord } from './check-ghost-package-refs.mjs';
import { readWorkspaceManifests } from './check-workspace-refs.mjs';
import { collectFiles } from './enumerate-files.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import {
  PNPM_SUBCOMMANDS,
  SCRIPT_NAME,
  filterScriptOccurrences,
  isSelector,
} from './lib/pnpm-invocation.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** The corpus: every tree where someone writes a command down for someone else to run. */
export const PATHSPECS = ['*.md', '*.ts', '*.mjs'];

// `[ \t]`, never `\s`: `\s` crosses a newline, so a marker with nothing after it would take the
// FOLLOWING line as its reason and excuse an occurrence nobody wrote a reason for.
const ALLOW_UNDECLARED = /allow-undeclared-script:[ \t]*([A-Za-z0-9][^\n]*)/;

/** Whether this line carries the escape hatch WITH a reason. A bare marker exempts nothing. */
export function hasAllowedReason(line) {
  const match = ALLOW_UNDECLARED.exec(String(line ?? ''));
  return Boolean(match && match[1].trim());
}

/**
 * The findings one file contributes, given the workspace's name → scripts map.
 *
 * Split from the walk so every rule is assertable against a string rather than a tree.
 */
export function judgeText(text, file, scriptsByPackage) {
  const findings = [];
  const lines = String(text ?? '').split('\n');
  for (const occurrence of filterScriptOccurrences(text)) {
    if (PNPM_SUBCOMMANDS.has(occurrence.script)) continue;
    if (!SCRIPT_NAME.test(occurrence.script)) continue;
    if (hasAllowedReason(lines[occurrence.line - 1])) continue;
    for (const token of occurrence.packages) {
      if (isSelector(token)) continue;
      const scripts = scriptsByPackage.get(token);
      // Unresolvable: check-workspace-refs and check-ghost-package-refs own that question.
      if (!scripts) continue;
      if (scripts.has(occurrence.script)) continue;
      findings.push({
        file,
        line: occurrence.line,
        package: token,
        script: occurrence.script,
        detail: `${token} declares no \`${occurrence.script}\` script.`,
      });
    }
  }
  return findings;
}

let examinedFiles = 0;

/** How many files the last run read. Reset per run, so it can never read as a growing subject. */
export function examinedFileCount() {
  return examinedFiles;
}

export function findFilterScriptFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['packages'], {
    scan: 'filter-script-resolves',
    why: 'resolution is relative to the workspace package set; with none, every filter is unresolvable and none is judged — a pass over nothing',
  });
  const scriptsByPackage = new Map();
  for (const [name, manifest] of readWorkspaceManifests(root)) {
    scriptsByPackage.set(name, new Set(Object.keys(manifest.scripts ?? {})));
  }

  examinedFiles = 0;
  const findings = [];
  for (const relative of collectFiles(PATHSPECS, { cwd: root })) {
    const normalized = relative.split(path.sep).join('/');
    if (isImmutableHistoricalRecord(normalized)) continue;
    examinedFiles += 1;
    findings.push(
      ...judgeText(readFileSync(path.join(root, relative), 'utf8'), normalized, scriptsByPackage),
    );
  }
  return findings;
}

export function main(root = WORKSPACE_ROOT) {
  const findings = findFilterScriptFindings(root);
  process.stdout.write(`::examined:: ${examinedFiles} governed document(s) and source file(s)\n`);
  if (findings.length === 0) {
    process.stdout.write('filter-script-resolves scan passed.\n');
    return 0;
  }
  process.stdout.write('filter-script-resolves scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- ${finding.file}:${finding.line}: ${finding.detail}\n`);
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
