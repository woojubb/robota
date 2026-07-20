#!/usr/bin/env node

/**
 * HARNESS-030 — mechanical floor for the capability-reachability / agent-run done-gate.
 *
 * `backlog-execution.md` ("Capability Reachability — no library-seam N/A dodge") forbids marking the
 * user-execution gate "N/A" for a user-facing capability that ships as a library seam no surface enables, and
 * requires an AGENT-RUN e2e verification. "Is this a user-facing capability?" and "is the seam truly reachable?"
 * are SEMANTIC calls a scan cannot make (the FP hazard) — those stay with the GATE-COMPLETE reviewer. This floor
 * makes the OTHER half mechanical: once a spec DECLARES itself a capability, it MUST carry an agent-run
 * verification — no silent N/A, no missing evidence.
 *
 * Opt-in by design: three optional spec-doc frontmatter keys —
 *   `capability: true`            — the author (confirmed by the reviewer) declares a user-facing capability.
 *   `user_execution: agent-run | manual | none`  — how the user-execution gate was met.
 *   `user_execution_scenario: <path>`  — the agent-run evidence file (EXPLICIT reference, not a name guess —
 *      a spec's evidence may live under a differently-named scenario, e.g. SEC-001's is the GUI-007 scenario).
 *
 * Over `.agents/spec-docs/done/`, a spec with `capability: true`:
 *   1. MUST NOT record `user_execution: none` (or omit it) — a shipped capability cannot dodge the gate.
 *   2. with `user_execution: agent-run` MUST name a `user_execution_scenario:` path that EXISTS.
 * A spec WITHOUT `capability: true` is not checked (zero false positives).
 *
 * SCOPE (honest): this mechanizes ONLY the DECLARED half. "Is this a user-facing capability?" and "is the seam
 * truly reachable?" stay with the GATE-COMPLETE reviewer — an author who never sets `capability: true` is not
 * caught here (a warn-only capability-candidate surfacer over type/tags is a deferred follow-up; auto-detecting
 * capabilities is the FP hazard the backlog flags). This floor fences the "declared-then-dodge" recurrence.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const DONE_DIR = '.agents/spec-docs/done';

/** Read the `---` frontmatter block into a flat key→value map (string values). */
export function parseFrontmatter(source) {
  const m = /^---\n([\s\S]*?)\n---/.exec(source);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    // Strip a single layer of surrounding quotes so `key: "value"` resolves to `value` (a quoted
    // path would otherwise fail existsSync and yield a confusing "does not exist" for a real file).
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fm;
}

/**
 * Pure evaluation of one spec's capability declaration. `scenarioExists(path)` reports whether the named
 * evidence file exists (injected so the test can drive fixtures without disk). Returns a finding string, or
 * null if clean / not a declared capability.
 */
export function evaluateSpec(frontmatter, filename, scenarioExists) {
  if (String(frontmatter.capability).toLowerCase() !== 'true') return null; // opt-in: only declared capabilities
  const ux = (frontmatter.user_execution ?? '').toLowerCase();
  if (ux === '' || ux === 'none' || ux === 'n/a') {
    return `capability spec '${filename}' records no user-execution (user_execution: ${frontmatter.user_execution ?? '<missing>'}) — a shipped user-facing capability must NOT dodge the user-execution gate (no library-seam N/A). Verify it AGENT-RUN and set 'user_execution: agent-run' + 'user_execution_scenario: <path>'.`;
  }
  if (ux === 'agent-run') {
    const scenario = frontmatter.user_execution_scenario;
    if (!scenario) {
      return `capability spec '${filename}' declares 'user_execution: agent-run' but names no 'user_execution_scenario: <path>' evidence file.`;
    }
    if (!scenarioExists(scenario)) {
      return `capability spec '${filename}' names 'user_execution_scenario: ${scenario}' which does not exist.`;
    }
  }
  return null;
}

export function findCapabilityReachabilityFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const doneDir = path.join(root, DONE_DIR);
  if (!existsSync(doneDir)) return findings;
  const scenarioExists = (rel) => existsSync(path.join(root, rel));
  for (const entry of readdirSync(doneDir)) {
    if (!entry.endsWith('.md')) continue;
    const fm = parseFrontmatter(readFileSync(path.join(doneDir, entry), 'utf8'));
    const finding = evaluateSpec(fm, entry, scenarioExists);
    if (finding) findings.push(finding);
  }
  return findings;
}

function main() {
  const findings = findCapabilityReachabilityFindings();
  if (findings.length === 0) {
    console.log('capability-reachability scan passed.');
    process.exit(0);
  }
  console.error(
    'capability-reachability scan FAILED — a declared capability lacks agent-run verification:',
  );
  for (const f of findings) console.error(`  - ${f}`);
  console.error(
    '\nbacklog-execution.md: a user-facing capability (capability: true) must be reachable via a surface AND\n' +
      '  verified by an AGENT-RUN scenario — never marked N/A. Add the scenario under .agents/evals/scenarios/,\n' +
      '  or (if it is genuinely not a user-facing capability) drop the `capability: true` flag.',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
