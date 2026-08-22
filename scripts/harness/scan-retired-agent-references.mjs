#!/usr/bin/env node

/**
 * INFRA-131 — an agent is retired only when no live instruction still dispatches it.
 *
 * Scope: live agent definitions, rules, skills, specs, memory, direct open Tasks, nonterminal spec-doc
 * folders, the living remediation log, and harness source/tests. Completed/rejected/archive/release/changelog
 * history is intentionally outside the population. Directory traversal never follows symlinks.
 *
 * Exit 0 = the retired definition is absent and every live occurrence is an exact documented provenance
 * exception; 1 = findings. `--pre-delete` permits only the retiring definition while consumers migrate.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const RETIRED_NAME = ['architecture', 'auditor'].join('-');
const RETIRED_DEFINITION = `.claude/agents/${RETIRED_NAME}.md`;

const RECURSIVE_ROOTS = [
  '.claude/agents',
  '.agents/rules',
  '.agents/skills',
  '.agents/specs',
  '.agents/memory',
  '.agents/spec-docs/draft',
  '.agents/spec-docs/backlog',
  '.agents/spec-docs/todo',
  '.agents/spec-docs/active',
  'scripts/harness',
];
const SINGLE_FILES = ['.agents/architecture-remediation-log.md'];

/** Exact, stale-sensitive provenance that must retain the historical agent identity. */
export const RETIRED_REFERENCE_ALLOWLIST = [
  {
    file: '.agents/architecture-remediation-log.md',
    fingerprint: '75b135c22f289661164bdec684faf1e736f7c9ed4ce3ecea1f74158e0fd24157',
    reason: 'dated remediation-decision provenance',
  },
  {
    file: '.agents/architecture-remediation-log.md',
    fingerprint: 'aca635dbda1b3a49579d2fd2596e8223af3640043fcad4a88920557d0ffbd633',
    reason: 'dated remediation-decision provenance',
  },
  {
    file: '.agents/memory/MEMORY.md',
    fingerprint: 'd24d332dbe980bf69ce8a54022face56f7fcef3585e7d20e4ee2590f367121b7',
    reason: 'dated memory provenance',
  },
  {
    file: '.agents/memory/harness-mechanical-not-skilltree.md',
    fingerprint: '9715d575c954a890746f2433b451cca5cdd17e34b27ff09c4cffc3a50c267fa6',
    reason: 'dated memory provenance',
  },
  {
    file: '.agents/memory/web-surface-and-sec001.md',
    fingerprint: 'a7c863235b84cf4fbf6bd42592c5f03ad1145db374eee9a9e269a5c8221501c0',
    reason: 'dated memory provenance',
  },
  {
    file: '.agents/spec-docs/draft/HARNESS-017-dispatch-determinism-and-firing-measurement.md',
    fingerprint: 'cc224f2f1fd8cc3b9abafe39c3baf4e3a6f4ee4bdee03a731eae7c92a2dd830b',
    reason: 'pre-existing work-item provenance',
  },
  {
    file: '.agents/spec-docs/draft/HARNESS-017-dispatch-determinism-and-firing-measurement.md',
    fingerprint: '293177572fb9b13bbf80b97e266c66d9c24df669abae2bcb764bbd9985ef9b82',
    reason: 'pre-existing work-item provenance',
  },
  {
    file: '.agents/spec-docs/draft/HARNESS-017-dispatch-determinism-and-firing-measurement.md',
    fingerprint: 'd56373310464e235b1b9b536036cff7b7e9da3a5744b1963f24585dc1d458ddb',
    reason: 'pre-existing work-item provenance',
  },
  {
    file: '.agents/tasks/HARNESS-049-rule-to-skill-agent-refactor.md',
    fingerprint: '009aa385a978311ddf4aebc05bddea6bbff79bfee6cb6e28761355367b80dd14',
    reason: 'pre-existing work-item provenance',
  },
  {
    file: '.agents/tasks/HARNESS-049-rule-to-skill-agent-refactor.md',
    fingerprint: '9db1b9958004c2d92993779e4bcefa80d69307b5e08a04ef756119a9fc172278',
    reason: 'pre-existing work-item provenance',
  },
];

let examinedFiles = 0;

export function examinedRetiredReferenceFileCount() {
  return examinedFiles;
}

export function normalizedLineFingerprint(line) {
  return createHash('sha256').update(line.trim().replace(/\s+/g, ' ')).digest('hex');
}

function walkFiles(root, rel) {
  const absolute = path.join(root, rel);
  if (!existsSync(absolute)) return [];
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new Error(
      `retired-agent-references: governed recursive root ${rel} is a symlink; refusing to follow it`,
    );
  }
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = path.posix.join(rel, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `retired-agent-references: governed path ${child} is a symlink; refusing to follow it`,
      );
    }
    if (entry.isDirectory()) files.push(...walkFiles(root, child));
    else if (entry.isFile() && /\.(?:md|mjs|json|sh)$/.test(entry.name)) files.push(child);
  }
  return files;
}

function liveFiles(root) {
  const files = RECURSIVE_ROOTS.flatMap((rel) => walkFiles(root, rel));
  const tasksDir = path.join(root, '.agents/tasks');
  if (existsSync(tasksDir)) {
    for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new Error(
          `retired-agent-references: governed path .agents/tasks/${entry.name} is a symlink; refusing to follow it`,
        );
      }
      if (entry.isFile() && entry.name.endsWith('.md')) files.push(`.agents/tasks/${entry.name}`);
    }
  }
  for (const rel of SINGLE_FILES) if (existsSync(path.join(root, rel))) files.push(rel);
  return [...new Set(files)].sort();
}

function allowlistKey(file, line) {
  return `${file}\0${normalizedLineFingerprint(line)}`;
}

export function findRetiredAgentReferenceFindings(
  root = WORKSPACE_ROOT,
  { mode = 'normal', allowlist = RETIRED_REFERENCE_ALLOWLIST } = {},
) {
  requireGovernedTree(root, [...RECURSIVE_ROOTS, '.agents/tasks', ...SINGLE_FILES], {
    scan: 'retired-agent-references',
    why: 'These live instruction trees and records are the complete retirement population; if any is absent, a passing result could hide a remaining dispatch reference.',
  });
  for (const rel of [...RECURSIVE_ROOTS, '.agents/tasks', ...SINGLE_FILES]) {
    if (lstatSync(path.join(root, rel)).isSymbolicLink()) {
      throw new Error(
        `retired-agent-references: governed path ${rel} is a symlink; refusing to follow it`,
      );
    }
  }
  examinedFiles = 0;
  const findings = [];
  const allowed = new Map();
  for (const entry of allowlist) {
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      findings.push({
        file: entry.file,
        line: null,
        detail: 'retired-agent provenance allowlist entry has no non-empty reason',
      });
      continue;
    }
    const key = `${entry.file}\0${entry.fingerprint}`;
    const group = allowed.get(key) ?? [];
    group.push(entry);
    allowed.set(key, group);
  }
  const used = new Map();
  for (const file of liveFiles(root)) {
    examinedFiles += 1;
    const lines = readFileSync(path.join(root, file), 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.includes(RETIRED_NAME)) continue;
      if (mode === 'pre-delete' && file === RETIRED_DEFINITION) continue;
      const key = allowlistKey(file, line);
      const allowance = allowed.get(key) ?? [];
      const consumed = used.get(key) ?? 0;
      if (consumed < allowance.length) {
        used.set(key, consumed + 1);
        continue;
      }
      findings.push({
        file,
        line: index + 1,
        detail: `live reference to retired agent \`${RETIRED_NAME}\` is not documented provenance`,
      });
    }
  }
  for (const [key, entries] of allowed) {
    const consumed = used.get(key) ?? 0;
    for (const entry of entries.slice(consumed)) {
      findings.push({
        file: entry.file,
        line: null,
        detail: `stale retired-agent provenance allowlist entry: ${entry.reason}`,
      });
    }
  }
  if (mode === 'normal' && existsSync(path.join(root, RETIRED_DEFINITION))) {
    findings.push({
      file: RETIRED_DEFINITION,
      line: null,
      detail: `retired definition still exists; normal mode requires it absent`,
    });
  }
  return findings;
}

function main(argv = process.argv.slice(2)) {
  const mode = argv.includes('--pre-delete') ? 'pre-delete' : 'normal';
  const findings = findRetiredAgentReferenceFindings(WORKSPACE_ROOT, { mode });
  console.error(`::examined:: ${examinedRetiredReferenceFileCount()} live retired-reference files`);
  if (findings.length === 0) {
    console.log(`retired-agent-references scan passed (${mode}).`);
    return 0;
  }
  console.error(`retired-agent-references scan failed (${mode}):`);
  for (const finding of findings) {
    console.error(
      `  - ${finding.file}${finding.line ? `:${finding.line}` : ''}: ${finding.detail}`,
    );
  }
  return 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) process.exitCode = main();
