#!/usr/bin/env node

/**
 * A catalogued mistake with no mechanism will recur — so every entry says which it is.
 *
 * Writing a mistake down demonstrably does not stop it. The clearest instance in this repository:
 * an anti-rot firing over a subject it did not govern was fixed in one scan, the lesson recorded —
 * and the identical defect was written into a NEW scan hours later, by the same author. Cataloguing
 * is not prevention; it only feels like it.
 *
 * Every entry in the common-mistakes catalogue therefore carries one of two answers:
 *
 *   **Mechanism:** `some-registered-scan`      — something fires when this is violated
 *   **Mechanism:** none — <reason>             — we are choosing to let this recur, and why
 *
 * THE SECOND VALUE IS THE POINT. Without it, "no mechanism" is the default that happens by omission
 * and reads like an oversight nobody decided. Written down, it is a decision, and the COUNT of those
 * decisions is printed on every run — because if that number is large, the number is the finding.
 *
 * A NAMED MECHANISM MUST EXIST. A `Mechanism:` naming a scan that is not registered would otherwise
 * be satisfied by a mention, which is the exact defect class this catalogue is about: a claim that
 * something is enforced, with nothing behind it. Three forms are accepted and each is checked:
 *
 *   - a registered scan name, verified against `run-all-scans.mjs`;
 *   - `lint:<rule>`, verified against the ESLint configuration;
 *   - `ci:<job>`, verified against the workflow files.
 *
 * WHAT THIS DOES NOT CLAIM. That the named scan actually catches that entry — only that it exists
 * and runs. Proving the link would need a failing input per entry, which is the next item's work,
 * not a reason to leave the field unchecked.
 *
 * That limit is not theoretical: the first version of this catalogue named `dep-kind` for the
 * foundation-dependency rule, and this scan passed it, because `dep-kind` is registered. It is a
 * different rule — a runtime value import resolving to a devDependencies-only declaration — and the
 * one that actually enforces the entry is `deps`. A human reviewer caught it. A RIGHT name and an
 * EXISTING name are different properties, and only the second is checked here.
 *
 * Exit 0 = every entry answers, and every named mechanism resolves.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { SCAN_COMMANDS } from './run-all-scans.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const CATALOGUE = '.agents/rules/common-mistakes.md';

const ENTRY = /^\|\s*(\d+)\s*\|/;
const MECHANISM = /\*\*Mechanism:\*\*\s*(?:`([^`]+)`|none\s*—\s*([^.|]+))/;

/** Each catalogue row's number and the mechanism it claims, or `null` when it claims none at all. */
export function readEntries(source) {
  const entries = [];
  for (const line of source.split('\n')) {
    const row = ENTRY.exec(line);
    if (!row) continue;
    const claim = MECHANISM.exec(line);
    entries.push({
      number: Number(row[1]),
      named: claim?.[1] ?? null,
      acceptedReason: claim?.[2]?.trim() ?? null,
      answered: Boolean(claim),
    });
  }
  return entries;
}

/**
 * Judge the catalogue against what the repository actually runs.
 *
 * `known` carries the three namespaces a mechanism may live in. Injected so a case can describe a
 * repository without one.
 */
export function judgeEntries(entries, known) {
  const findings = [];
  for (const entry of entries) {
    if (!entry.answered) {
      findings.push({
        entry: entry.number,
        kind: 'no-answer',
        detail:
          'names no mechanism and does not admit it has none. "No mechanism" must be a decision, ' +
          'not the state that happens when nobody wrote one.',
      });
      continue;
    }
    if (entry.named === null) {
      if (!entry.acceptedReason) {
        findings.push({
          entry: entry.number,
          kind: 'accepted-without-a-reason',
          detail: 'admits it has no mechanism and gives no reason. The reason is the decision.',
        });
      }
      continue;
    }
    const [namespace, rest] = entry.named.startsWith('lint:')
      ? ['lint', entry.named.slice(5)]
      : entry.named.startsWith('ci:')
        ? ['ci', entry.named.slice(3)]
        : ['scan', entry.named];
    if (!known[namespace].has(rest)) {
      findings.push({
        entry: entry.number,
        kind: 'names-a-mechanism-that-does-not-exist',
        detail: `\`${entry.named}\` is not a registered ${namespace}. A field satisfied by a mention is the defect this catalogue is about.`,
      });
    }
  }
  return findings;
}

/** Registered scan names, lint rules configured anywhere, and job names any workflow declares. */
export function knownMechanisms(root = WORKSPACE_ROOT) {
  const scans = new Set(SCAN_COMMANDS.map((scan) => scan.name));

  const lint = new Set();
  for (const file of ['eslint.config.js', 'eslint.config.mjs', '.eslintrc.json', '.eslintrc.js']) {
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    // BOTH quotings. The configuration here is JSON, where a rule name is double-quoted; the first
    // version matched single quotes only and reported two real, configured rules as not existing —
    // the check firing on correct data, caught by running it.
    const text = readFileSync(full, 'utf8');
    for (const rule of text.matchAll(/["']([@a-z0-9][@a-z0-9/-]*)["']\s*:\s*(?:["']|\[|\d)/gi)) {
      lint.add(rule[1]);
    }
  }

  const ci = new Set();
  const workflows = path.join(root, '.github/workflows');
  if (existsSync(workflows)) {
    for (const name of readdirSync(workflows).filter((n) => /\.ya?ml$/.test(n))) {
      const text = readFileSync(path.join(workflows, name), 'utf8');
      let inJobs = false;
      for (const raw of text.split('\n')) {
        if (/^jobs:/.test(raw)) {
          inJobs = true;
          continue;
        }
        if (!inJobs) continue;
        if (/^\S/.test(raw)) {
          inJobs = false;
          continue;
        }
        const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(raw);
        if (job) ci.add(job[1]);
      }
    }
  }
  return { scan: scans, lint, ci };
}

export function scanMistakeMechanisms(root = WORKSPACE_ROOT) {
  const file = path.join(root, CATALOGUE);
  // Fail closed: a catalogue that is not there has no unanswered entries, and that is not a pass.
  if (!existsSync(file))
    throw new Error(`mistake-mechanisms: ${CATALOGUE} does not exist under ${root}.`);
  const entries = readEntries(readFileSync(file, 'utf8'));
  if (entries.length === 0) throw new Error(`mistake-mechanisms: ${CATALOGUE} holds no entries.`);

  const findings = judgeEntries(entries, knownMechanisms(root));
  const accepted = entries.filter((e) => e.answered && e.named === null).length;
  return { entries: entries.length, accepted, findings };
}

function main() {
  const { entries, accepted, findings } = scanMistakeMechanisms();
  console.log(`::examined:: ${entries} catalogue entries`);

  if (findings.length > 0) {
    console.error(`mistake-mechanisms scan failed: ${findings.length} entr(y/ies):`);
    for (const finding of findings) {
      console.error(`  - [${finding.kind}] entry #${finding.entry}: ${finding.detail}`);
    }
    process.exitCode = 1;
    return;
  }
  // Printed on EVERY run, not only when something is wrong: if this number is large, the number is
  // the finding, and a finding nobody sees is one nobody acts on.
  console.log(
    `mistake-mechanisms scan passed (${entries} entr(y/ies); ${entries - accepted} name a mechanism, ` +
      `${accepted} are ACCEPTED AS RECURRING with a recorded reason). The second number is the debt.`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
