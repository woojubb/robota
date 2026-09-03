#!/usr/bin/env node

/**
 * Task `## Plan` items — the mechanical floor under GATE-VERIFY's first criterion (issue #2375).
 *
 * Two questions the gate catalogue stated and nobody enforced:
 *
 *   1. A Plan may NOT contain its own disposition. "Land and close issue #N" as the last Plan item
 *      cannot be `[x]` before GATE-VERIFY, because landing is what GATE-VERIFY authorises — so the
 *      gate becomes unsatisfiable by construction and is passed by ticking a false box, editing the
 *      Plan, or passing over the criterion. Refused here at planning time, where it is cheap.
 *   2. GATE-VERIFY reads the `## Plan` SECTION, not the whole file. Measured: 86 done records carry
 *      an unchecked box somewhere (test-plan rows, reviewer checklists — where `[ ]` means something
 *      else), 2 inside `## Plan`. A guard on the whole file fires constantly; one on the section
 *      finds the real cases.
 *
 * The population that predates this floor is CONTAINED by name in `task-plan-items-baseline.json`
 * with a reason — records are not rewritten to manufacture a green history, and the list can only
 * shrink (a name that no longer needs its exemption is a finding until it is removed).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from './shared.mjs';
import { classifyTaskLifecycle } from './task-lifecycle.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const TASKS_DIR = '.agents/tasks';
export const BASELINE_PATH = 'scripts/harness/task-plan-items-baseline.json';

/**
 * A Plan item that names the disposition of the work itself. Verbs only — "closing the connection"
 * or "merge two arrays" would be false positives, so the object has to be the unit: a branch, PR,
 * issue, Task, spec, or the base branch.
 */
const DISPOSITION_PATTERN =
  /\b(?:merge[ds]?|merging|land(?:ed|s|ing)?|close[ds]?|closing|publish(?:ed|es|ing)?)\b[^\n]*?\b(?:issue|issues|PR|pull request|branch|`?develop`?|`?main`?|this (?:AGREEMENT|Task|spec|item|change)|the (?:AGREEMENT|Task|spec|item|change)|child Tasks?|package|npm)\b/i;

let examinedPlans = 0;
export function examinedPlanCount() {
  return examinedPlans;
}

export function planSection(text) {
  const match = /^## Plan[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
  return match ? match[1] : null;
}

export function planItems(section) {
  return section
    .split('\n')
    .map((line) => /^\s*- \[( |x|X)\]\s*(.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({ checked: match[1] !== ' ', text: match[2].trim() }));
}

export function isDispositionItem(text) {
  return DISPOSITION_PATTERN.test(text);
}

function readBaseline(root) {
  const file = path.join(root, BASELINE_PATH);
  if (!existsSync(file)) return { disposition: {}, unchecked: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}

function taskFiles(root) {
  const dir = path.join(root, TASKS_DIR);
  // Fail closed (HARNESS-052): the task corpus IS the population; over a root without it there is
  // no plan to judge, and "no findings" would read exactly like "every plan is well-formed".
  if (!existsSync(dir)) throw new Error(`task-plan-items: ${TASKS_DIR} missing from ${root}`);
  const open = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => ({ file: `${TASKS_DIR}/${name}`, name, archived: false }));
  const completedDir = path.join(dir, 'completed');
  const completed = existsSync(completedDir)
    ? readdirSync(completedDir)
        .filter((name) => name.endsWith('.md'))
        .map((name) => ({ file: `${TASKS_DIR}/completed/${name}`, name, archived: true }))
    : [];
  return [...open, ...completed].sort((a, b) => a.file.localeCompare(b.file));
}

export function findTaskPlanItemFindings(root = WORKSPACE_ROOT) {
  examinedPlans = 0;
  const baseline = readBaseline(root);
  const findings = [];
  const usedDisposition = new Set();
  const usedUnchecked = new Set();
  for (const { file, name, archived } of taskFiles(root)) {
    const text = readFileSync(path.join(root, file), 'utf8');
    const section = planSection(text);
    if (section === null) continue;
    examinedPlans += 1;
    const items = planItems(section);
    const lifecycle = classifyTaskLifecycle(text);

    const dispositions = items.filter((item) => isDispositionItem(item.text));
    if (dispositions.length > 0) {
      if (baseline.disposition[name] !== undefined) usedDisposition.add(name);
      else if (!archived) {
        for (const item of dispositions) {
          findings.push({
            rule: 'plan-names-own-disposition',
            file,
            detail:
              `Plan item \`${item.text.slice(0, 80)}\` names the disposition of the work (merge/land/close/publish). ` +
              'It cannot be `[x]` before GATE-VERIFY, which is what authorises it — move it out of `## Plan` (issue #2375).',
          });
        }
      }
    }

    if (lifecycle.status === 'done') {
      const unchecked = items.filter((item) => !item.checked);
      if (unchecked.length > 0) {
        if (baseline.unchecked[name] !== undefined) usedUnchecked.add(name);
        else {
          findings.push({
            rule: 'done-plan-item-unchecked',
            file,
            detail:
              `\`status: done\` with ${unchecked.length} unchecked \`## Plan\` item(s), the first: \`${unchecked[0].text.slice(0, 80)}\`. ` +
              'GATE-VERIFY requires every Plan item `[x]`; this record reached a terminal status past that criterion (issue #2375).',
          });
        }
      }
    }
  }
  // A ratchet: an exemption nothing uses any more is removed, never kept as slack.
  for (const name of Object.keys(baseline.disposition)) {
    if (!usedDisposition.has(name)) {
      findings.push({
        rule: 'baseline-exemption-unused',
        file: BASELINE_PATH,
        detail: `\`disposition\` exemption for ${name} no longer matches a Plan item — remove it.`,
      });
    }
  }
  for (const name of Object.keys(baseline.unchecked)) {
    if (!usedUnchecked.has(name)) {
      findings.push({
        rule: 'baseline-exemption-unused',
        file: BASELINE_PATH,
        detail: `\`unchecked\` exemption for ${name} no longer matches an unchecked Plan item — remove it.`,
      });
    }
  }
  return findings;
}

export function main() {
  const findings = findTaskPlanItemFindings(WORKSPACE_ROOT);
  process.stdout.write(`::examined:: ${examinedPlans} Task Plan sections\n`);
  if (findings.length === 0) {
    process.stdout.write('task-plan-items scan passed.\n');
    return;
  }
  process.stdout.write('task-plan-items scan failed:\n');
  for (const f of findings) process.stdout.write(`- [${f.rule}] ${f.file}: ${f.detail}\n`);
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
