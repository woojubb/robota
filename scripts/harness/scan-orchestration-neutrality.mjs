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

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

// App-domain identity terms forbidden in the neutral orchestration contracts.
// Matches any identifier-like token CONTAINING the term (case-insensitive), so
// `roomId` / `chatRoom` / `personaName` / `topicTitle` / `conversationTopic` are all
// flagged — not merely the standalone word.
const FORBIDDEN = /\w*(room|persona|topic)\w*/i;

// Directories whose orchestration source is the neutral surface under scan.
const SCAN_DIRS = [
  'packages/agent-core/src/orchestration',
  'packages/agent-framework/src/orchestration',
];

function walkSource(target) {
  const full = path.join(WORKSPACE_ROOT, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return full.endsWith('.ts') ? [full] : [];
  const files = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    // Neutrality is a property of the CONTRACTS + mechanism, not test fixtures.
    if (entry.name === '__tests__') continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSource(child));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path.join(WORKSPACE_ROOT, child));
    }
  }
  return files;
}

/**
 * Pure content check: return the neutrality violations in a source string.
 * Exposed so the harness test can assert failing-capability directly (including the
 * camelCase identifier vector) without touching disk.
 */
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
  const findings = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkSource(dir)) {
      const rel = path.relative(root, file);
      findings.push(...findNeutralityViolationsInSource(readFileSync(file, 'utf8'), rel));
    }
  }
  return findings;
}

function main() {
  const findings = findOrchestrationNeutralityFindings();
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
