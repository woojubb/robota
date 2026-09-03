#!/usr/bin/env node

/**
 * SELFHOST-001 TC-05 — standing neutrality floor for the multi-agent orchestration
 * contracts.
 *
 * The neutral orchestration primitives (`sequential`/`parallel`/`hierarchical`/
 * `handoff`/`group-chat`) must carry NO app-domain identity (chat-room / persona /
 * conversation-topic style fields), per the Library Neutrality Rule (TRANS-001).
 * This scan keeps FIRING on every run so P2/P3's `hierarchical`/`group-chat`
 * additions cannot smuggle those concepts in later — it is NOT a one-time vitest,
 * and NOT the `interface-runtime` scan (which neither covers `agent-core` nor
 * checks app-domain field names, so it would be false-green here).
 *
 * It flags the app-domain identifiers `room` / `persona` / `topic` anywhere in the
 * orchestration source (contracts + mechanism), excluding test files. The match is
 * IDENTIFIER-CONTAINING (not whole-word), so the realistic smuggling vector — a
 * camelCase field like `roomId`, `chatRoom`, `personaName`, `topicTitle`,
 * `conversationTopic` — is caught, not just the bare word. The scanner's own pattern
 * definition is the only allowed occurrence of those words under scan.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

// App-domain identity terms forbidden in the neutral orchestration contracts, held as POLICY DATA in
// `.agents/harness.config.json` (`neutrality.orchestrationForbiddenTerms` / `orchestrationScanDirs`,
// HARNESS-DIET-002) so this engine stays repo-agnostic. The pattern matches any identifier-like token CONTAINING
// a term (case-insensitive), so `roomId` / `chatRoom` / `personaName` / `topicTitle` / `conversationTopic` are
// all flagged — not merely the standalone word.
const NEUTRALITY = loadHarnessConfig().neutrality;
const FORBIDDEN = new RegExp(`\\w*(${NEUTRALITY.orchestrationForbiddenTerms.join('|')})\\w*`, 'i');

// Directories whose orchestration source is the neutral surface under scan.
const SCAN_DIRS = NEUTRALITY.orchestrationScanDirs;

/**
 * `root` is a PARAMETER, not decoration (HARNESS-052, the same defect this item fixed in
 * `scan-no-fallback`): this walker closed over `WORKSPACE_ROOT`, so the finder's `root` argument
 * changed nothing and every caller — including the fail-closed measurement harness — was silently
 * handed a verdict about the real repository instead of the root it asked about.
 */
function walkSource(target, root) {
  const full = path.join(root, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return full.endsWith('.ts') ? [full] : [];
  const files = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    // Neutrality is a property of the CONTRACTS + mechanism, not test fixtures.
    if (entry.name === '__tests__') continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSource(child, root));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path.join(root, child));
    }
  }
  return files;
}

/**
 * Pure content check: return the neutrality violations in a source string.
 * Exposed so the harness test can assert failing-capability directly (including the
 * camelCase identifier vector) without touching disk.
 */
/**
 * How many source files the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases (HARNESS-057). RESET at the top of the walk, so a run that reads nothing cannot report the
 * previous run's number.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export function findNeutralityViolationsInSource(source, file = 'fixture.ts') {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (FORBIDDEN.test(lines[i])) {
      findings.push({ file, line: i + 1, text: lines[i].trim() });
    }
  }
  return findings;
}

export function findOrchestrationNeutralityFindings(root = WORKSPACE_ROOT) {
  examinedCount = 0;
  requireGovernedTree(root, SCAN_DIRS, {
    scan: 'orchestration-neutrality',
    why: 'The configured orchestration contract directories ARE the subject: over a root without them, "no app-domain identity leaks into the neutral contracts" is a statement about no contracts.',
  });
  const findings = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkSource(dir, root)) {
      const rel = path.relative(root, file);
      examinedCount += 1;
      findings.push(...findNeutralityViolationsInSource(readFileSync(file, 'utf8'), rel));
    }
  }
  return findings;
}

function main() {
  const findings = findOrchestrationNeutralityFindings();

  // Before the branch, for the reason above: the adoption count is read from every run.
  console.log(`::examined:: ${examinedCount} source files`);

  if (findings.length === 0) {
    console.log('orchestration-neutrality scan passed.');
    process.exit(0);
  }
  console.error(
    'orchestration-neutrality scan FAILED — app-domain identity (room/persona/topic) in the neutral orchestration contracts:',
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.text}`);
  }
  console.error(
    '\nThe orchestration primitives must stay neutral mechanisms (TRANS-001). Remove the app-domain field, or move the concept to a product/app layer.',
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
