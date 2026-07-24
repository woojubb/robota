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

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

export function collectOrchestrationMapFindings(root = WORKSPACE_ROOT) {
  const agentsDir = path.join(root, '.claude/agents');
  const mapPath = path.join(root, '.agents/specs/orchestration-map.md');

  if (!existsSync(mapPath)) {
    return { mapMissing: true, findings: [] };
  }
  const mapText = readFileSync(mapPath, 'utf8');

  const findings = [];
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(path.join(agentsDir, file), 'utf8');
      const m = text.match(/^name:\s*(\S+)\s*$/m);
      const name = m ? m[1] : file.replace(/\.md$/, '');
      // Require the agent name to appear in the map (e.g. as `name` in a table/diagram).
      if (!mapText.includes(name)) {
        findings.push(
          `agent "${name}" (.claude/agents/${file}) is not listed in the Orchestration Map — add it (role, signal, pipeline).`,
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
