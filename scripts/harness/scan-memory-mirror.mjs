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
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

export function collectMemoryMirrorFindings(root = WORKSPACE_ROOT) {
  const memDir = path.join(root, '.agents/memory');
  const index = path.join(memDir, 'MEMORY.md');
  const findings = [];

  if (!existsSync(memDir)) {
    // No in-repo memory yet is allowed; the rule only bites once memory exists.
    return findings;
  }

  if (!existsSync(index)) {
    findings.push(
      '.agents/memory/ exists but has no MEMORY.md index (every clone needs the index to find facts).',
    );
    return findings;
  }

  const indexText = readFileSync(index, 'utf8');

  // Fact files = every *.md in .agents/memory except the index itself.
  const factFiles = readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');

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
  if (!existsSync(path.join(WORKSPACE_ROOT, '.agents/memory'))) {
    // No in-repo memory yet is allowed; the rule only bites once memory exists.
    process.exit(0);
  }

  const findings = collectMemoryMirrorFindings();

  if (findings.length > 0) {
    console.error('memory-mirror scan: FINDINGS');
    for (const f of findings) console.error('  - ' + f);
    console.error(
      '\nFix: keep .agents/memory/MEMORY.md and its fact files consistent (see .agents/rules/memory-mirroring.md).',
    );
    process.exit(1);
  }

  console.log('memory-mirror scan passed.');
  process.exit(0);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
