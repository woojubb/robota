#!/usr/bin/env node

/**
 * Mechanizes the Memory Mirroring rule (.agents/rules/memory-mirroring.md).
 *
 * The rule: durable knowledge written to an agent's session/host memory MUST also be
 * mirrored into in-repo memory (.agents/memory/) so every clone shares one harness.
 *
 * This scan enforces the REPO-SIDE invariant that keeps the mirror trustworthy:
 * the in-repo memory index (.agents/memory/MEMORY.md) and the memory fact files must
 * stay consistent — no dangling index pointer (index → missing file) and no orphan
 * fact file (file present but absent from the index). A drifting index silently hides
 * or fabricates shared knowledge, which defeats the rule.
 *
 * (The cross-boundary half — detecting a session/host-memory write that was NOT
 * mirrored — lives in the .claude/hooks/ PostToolUse reminder, since session memory is
 * external to the repo and not visible to a repo scan.)
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/**
 * How many memory fact files the last run examined — read by `main` for its `::examined::` line.
 *
 * A module-level holder rather than a changed return shape, because the finder is imported by tests
 * that assert on its findings; widening the return would rewrite them to prove nothing new.
 */
let examinedFactFiles = 0;

/** What the last `collectMemoryMirrorFindings` run walked — exported so it can be asserted. */
export function examinedFactFileCount() {
  return examinedFactFiles;
}

export function collectMemoryMirrorFindings(root = WORKSPACE_ROOT) {
  // Reset FIRST, before anything can return. The same correction was made in the workflow-permissions
  // scan in this change and not mirrored here: a holder reset late reports the previous run's number
  // for a run that examined nothing, and the early returns below are exactly those runs.
  examinedFactFiles = 0;
  requireGovernedTree(root, ['.agents/memory'], {
    scan: 'memory-mirror',
    why: 'memory-mirroring.md makes the in-repo memory corpus mandatory here, so its absence is a broken checkout rather than a repository that has not started one.',
  });
  const memDir = path.join(root, '.agents/memory');
  const index = path.join(memDir, 'MEMORY.md');
  const findings = [];

  if (!existsSync(index)) {
    findings.push(
      '.agents/memory/ exists but has no MEMORY.md index (every clone needs the index to find facts).',
    );
    return findings;
  }

  const indexText = readFileSync(index, 'utf8');

  // Fact files = every *.md in .agents/memory except the index itself.
  const factFiles = readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
  examinedFactFiles = factFiles.length;

  // Linked targets in the index: markdown links to local .md files, e.g. [Title](slug.md)
  const linked = new Set(
    [...indexText.matchAll(/\]\(([^)]+\.md)\)/g)]
      .map((m) => m[1].trim())
      .filter((href) => !href.includes('/') || href.startsWith('./'))
      .map((href) => href.replace(/^\.\//, '')),
  );

  // Dangling: index points to a file that does not exist.
  for (const href of linked) {
    if (href === 'MEMORY.md') continue;
    if (!existsSync(path.join(memDir, href))) {
      findings.push(`MEMORY.md links a missing memory file: ${href}`);
    }
  }

  // Orphan: a fact file that the index never links.
  for (const f of factFiles) {
    if (!linked.has(f)) {
      findings.push(
        `memory file not indexed in MEMORY.md (orphan — invisible to other clones): ${f}`,
      );
    }
  }

  return findings;
}

export function main() {
  // No early return for an absent `.agents/memory`. One stood here saying "no in-repo memory yet is
  // allowed", which contradicted this file's own finder — `requireGovernedTree` declares the corpus
  // MANDATORY and an absent one a broken checkout. Two answers in one file, and the CLI took the
  // wrong one: it exited 0 without reaching the throw its own test pins, and without printing the
  // examined line every other path here prints. A guard that can exit silently over ground it never
  // read is the defect this scan's declaration was added to expose.
  const findings = collectMemoryMirrorFindings();

  if (findings.length > 0) {
    console.error('memory-mirror scan: FINDINGS');
    for (const f of findings) console.error('  - ' + f);
    console.error(
      '\nFix: keep .agents/memory/MEMORY.md and its fact files consistent (see .agents/rules/memory-mirroring.md).',
    );
    process.exit(1);
  }

  // A legitimate zero, declared. The index may exist with no fact files beside it yet — a bootstrap
  // or post-cleanup state the scan itself considers clean — and an undeclared zero is a hard failure
  // in the runner. Saying why is the whole contract; staying silent would redden the suite for a
  // state this scan calls correct.
  console.log(
    examinedFactFiles === 0
      ? '::examined:: 0 memory fact files ::expected-empty:: the index may exist before any fact ' +
          'file does, and the mirroring rule only bites once memory exists'
      : `::examined:: ${examinedFactFiles} memory fact files`,
  );
  console.log('memory-mirror scan passed.');
  process.exit(0);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
