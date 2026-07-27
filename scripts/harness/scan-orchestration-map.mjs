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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

export function collectOrchestrationMapFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['.claude/agents'], {
    scan: 'orchestration-map',
    why:
      'The agent definitions are the set the map is checked against; with none, "every agent is listed" is true of nothing.',
  });
  const agentsDir = path.join(root, '.claude/agents');
  const mapPath = path.join(root, '.agents/specs/orchestration-map.md');

  if (!existsSync(mapPath)) {
    return { mapMissing: true, findings: [] };
  }
  const mapText = readFileSync(mapPath, 'utf8');
  const rowNames = mapRowNames(mapText);

  const findings = [];
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(path.join(agentsDir, file), 'utf8');
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

  console.log('orchestration-map scan passed.');
  process.exit(0);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
