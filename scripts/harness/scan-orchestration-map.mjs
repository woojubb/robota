#!/usr/bin/env node

/**
 * Keeps the Orchestration Map (.agents/specs/orchestration-map.md) current.
 *
 * The map is the single at-a-glance registry of the orchestrator/worker/guardian pipelines
 * (enforcement-architecture.md). For it to stay trustworthy it must list every agent: a new
 * `.claude/agents/*.md` that is not in the map means the map is silently stale. This scan FAILs
 * when an agent is missing, so an agent cannot land without being mapped.
 *
 * (Scope: agent coverage — the clearest mechanical set. Orchestrator-skill coverage is maintained
 * in the map's Pipelines table by convention; agents are the enforced floor.)
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

// HARNESS-046: frontmatter is read by the harness's ONE parser. The hand-rolled `/^name:/m` this
// replaced was not anchored to the `---` block, so a `name:` inside a body example could become the
// identity the map was checked against.
import { asScalar, frontmatterObject } from './frontmatter.mjs';
import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Agent names that own a ROW in one of the map's registry tables — the first cell of a table line,
 * as a backticked token.
 *
 * HARNESS-052 sub-shape A. The rule was `mapText.includes(name)`, which proves "listed in the
 * Orchestration Map" with any occurrence anywhere: the name in prose, inside a fenced diagram, in a
 * footnote, or as a SUBSTRING of a different agent's name — `pr-review-review` is contained in
 * `pr-review-reviewer`, so deleting one agent's row could leave another's check satisfied by it.
 * "Listed" means it has a row, and a row is a structure, so the structure is what is read.
 *
 * Measured before tightening, because a rule that fires on correct data gets suppressed: every agent
 * definition in this repository already owns a first-cell row, so this narrows the accepted evidence
 * without inventing work. What it does NOT demand is a formatting convention — the name may be
 * backticked, bolded or bare, because the structural claim is "it has a row", not "it is written a
 * particular way", and a guard that also polices styling is one people learn to route around.
 */
export function mapRowNames(mapText) {
  const names = new Set();
  for (const line of String(mapText ?? '').split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const firstCell = (line.split('|')[1] ?? '').replace(/[`*_[\]]/g, ' ');
    for (const match of firstCell.matchAll(/[A-Za-z0-9][\w-]*/g)) names.add(match[0]);
  }
  return names;
}

/** Escape a value being interpolated into a pattern. An agent name is data, not syntax. */
function reEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The agents a single skill's text dispatches. Pure, so the reading is testable without a tree —
 * this shipped with no regression test and its own review said so.
 */
export function dispatchedAgents(text, agentNames) {
  const dispatched = new Set();
  for (const sentence of text.replace(/\r?\n/g, ' ').split(/(?<=[.!?][*_`)\]]{0,3})\s+/)) {
    // An imperative naming the agent — the same reading `agents-cannot-be-told-to-dispatch` uses.
    // A sentence about what an agent OWNS is a reference, not a dispatch.
    if (/\bowns\b|\bis the\b|\bbelongs to\b|\bnot this skill/i.test(sentence)) continue;
    for (const name of agentNames) {
      // `hand` carries a boundary. Without it `handling`/`handles` anchors the match, so ordinary
      // prose — "this skill handles retries and reports to `some-agent`" — would demand a map edit
      // that no dispatch justifies. Demonstrated on the incident file itself.
      const re = new RegExp(
        `\\b(?:dispatch(?:es)?|calls?|invokes?|hand(?:s|ed)?\\b[^.\`]{0,30}\\bto)\\b[^.\`]{0,40}\`?${reEscape(name)}\`?`,
        'i',
      );
      if (re.test(sentence)) dispatched.add(name);
    }
  }
  return [...dispatched].sort();
}

/**
 * Every SKILL that dispatches an agent, and the agents it dispatches.
 *
 * The registry's stated purpose is to be current, and the drift it is most likely to suffer is
 * precisely the one nothing checked: a pipeline gains a dispatch and the map's row for that pipeline
 * is not updated. Measured twice on 2026-08-01 in #1546 — `architecture-refresh` gained a
 * `finding-depth-triager` step whose diagram node was missing, and `backlog-execution-orchestrator`
 * gained one with no row change at all. The scan passed both times, because it asked only whether
 * each AGENT has a row somewhere, never whether the pipeline USING it names it.
 */
export function skillDispatches(root, agentNames) {
  const skillsDir = path.join(root, '.agents/skills');
  if (!existsSync(skillsDir)) return [];
  const out = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const dispatched = dispatchedAgents(readFileSync(file, 'utf8'), agentNames);
    if (dispatched.length > 0) out.push({ skill: entry.name, agents: dispatched });
  }
  return out;
}

/**
 * Every pipeline row that mentions `skill`.
 *
 * ALL of them, not the first: a shared sub-orchestration appears in several pipelines, and asking
 * only the first row produced a false positive on `ci-gate-watch` — whose escalation target IS named
 * in the Release row and is not needed in the PR-review one. A guard that refuses correct work is a
 * guard that gets switched off.
 */
export function rowsForSkill(mapText, skill) {
  return mapText
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes(`\`${skill}\``));
}

/**
 * How many agent definitions the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases, and rewriting them to carry a number proves nothing new (HARNESS-057). It is RESET at the
 * top of the walk, so a run that reads nothing cannot report the previous run's number — which is
 * the whole failure this marker exists to expose.
 */
let agentsRead = 0;

export function collectOrchestrationMapFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['.claude/agents'], {
    scan: 'orchestration-map',
    why: 'The agent definitions are the set the map is checked against; with none, "every agent is listed" is true of nothing.',
  });
  const agentsDir = path.join(root, '.claude/agents');
  const mapPath = path.join(root, '.agents/specs/orchestration-map.md');

  if (!existsSync(mapPath)) {
    return { mapMissing: true, findings: [] };
  }
  const mapText = readFileSync(mapPath, 'utf8');
  const rowNames = mapRowNames(mapText);

  const findings = [];

  // The pipeline half: a skill that DISPATCHES an agent must have that agent in its own row. Asking
  // only "does every agent have a row" leaves the registry free to disagree with the wiring, which
  // is the whole thing it exists to record.
  const agentNames = existsSync(agentsDir)
    ? readdirSync(agentsDir)
        .filter((f) => f.endsWith('.md'))
        .map(
          (f) =>
            asScalar(frontmatterObject(readFileSync(path.join(agentsDir, f), 'utf8')).name) ||
            f.replace(/\.md$/, ''),
        )
    : [];
  for (const { skill, agents } of skillDispatches(root, agentNames)) {
    const rows = rowsForSkill(mapText, skill);
    if (rows.length === 0) continue; // the skill itself is unregistered — a different question
    for (const agent of agents) {
      if (!rows.some((row) => row.includes(`\`${agent}\``))) {
        findings.push(
          `skill "${skill}" dispatches "${agent}" but its Orchestration Map row does not name it — the registry disagrees with the wiring it exists to record.`,
        );
      }
    }
  }

  agentsRead = 0;
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(path.join(agentsDir, file), 'utf8');
      agentsRead += 1;
      const name = asScalar(frontmatterObject(text).name) || file.replace(/\.md$/, '');
      // Require the agent to own a registry ROW, not merely to be mentioned somewhere in the file.
      if (!rowNames.has(name)) {
        findings.push(
          `agent "${name}" (.claude/agents/${file}) has no row in the Orchestration Map — add one (role, signal, pipeline). A mention in prose or inside a diagram is not a listing.`,
        );
      }
    }
  }

  return { mapMissing: false, findings };
}

export function main() {
  const { mapMissing, findings } = collectOrchestrationMapFindings();

  if (mapMissing) {
    console.error('orchestration-map scan: .agents/specs/orchestration-map.md is missing.');
    process.exit(1);
  }

  if (findings.length > 0) {
    console.error('orchestration-map scan: FINDINGS');
    for (const f of findings) console.error('  - ' + f);
    console.error(
      '\nFix: update .agents/specs/orchestration-map.md in the same change (see its "How to change the structure").',
    );
    process.exit(1);
  }

  console.log(`::examined:: ${agentsRead} agent definitions`);
  console.log('orchestration-map scan passed.');
  process.exit(0);
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(import.meta.filename)
) {
  main();
}
