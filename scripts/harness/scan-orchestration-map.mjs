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

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const AGENTS_DIR = path.join(WORKSPACE_ROOT, '.claude/agents');
const MAP = path.join(WORKSPACE_ROOT, '.agents/specs/orchestration-map.md');

const findings = [];

if (!existsSync(MAP)) {
  console.error('orchestration-map scan: .agents/specs/orchestration-map.md is missing.');
  process.exit(1);
}
const mapText = readFileSync(MAP, 'utf8');

if (existsSync(AGENTS_DIR)) {
  for (const file of readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(path.join(AGENTS_DIR, file), 'utf8');
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
