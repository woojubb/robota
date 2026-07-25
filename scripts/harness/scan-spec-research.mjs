#!/usr/bin/env node

/**
 * Mechanizes research.md as a GATE-WRITE-level floor (the "research guardian" backstop).
 *
 * research.md mandates prior-art research (comparable products / OSS / AI-agent references, from
 * product docs — NOT source code) recorded under `## Prior Art Research`, feeding an evidence-based
 * recommendation. That rule was prose-only and unenforced (no writer-schema section, no gate criterion,
 * no scan) — so it was silently skipped. This scan is the machine floor: an in-flight spec must carry a
 * `## Prior Art Research` (or `## Research`) section that is EITHER populated with real evidence OR
 * explicitly waived with a reason. Research is DEFAULT-ON; the only way out is an explicit waiver.
 *
 * Populated = the section cites at least one documentation source (an http(s) link or a "no comparable
 * reference found" statement) — not a placeholder.
 * Waived   = a line matching `Waived: <reason>` (opt-out the agent proposed or the user requested).
 *
 * Scanned stages: draft, todo, active (specs that will be / are being implemented). done/rejected/backlog
 * are not gated here.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const STAGES = ['draft', 'todo', 'active'];

export function collectSpecResearchFindings(root = WORKSPACE_ROOT) {
  const specRoot = path.join(root, '.agents/spec-docs');
  const findings = [];

  for (const stage of STAGES) {
    const dir = path.join(specRoot, stage);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const rel = `.agents/spec-docs/${stage}/${file}`;
      const text = readFileSync(path.join(dir, file), 'utf8');

      const m = text.match(/^##\s+(Prior Art Research|Research)\s*$/im);
      if (!m) {
        findings.push(
          `${rel}: missing "## Prior Art Research" section (research.md is default-on; add the section or an explicit "Waived: <reason>").`,
        );
        continue;
      }
      // Body = from the heading to the next `## ` heading (or EOF).
      const start = m.index + m[0].length;
      const rest = text.slice(start);
      const next = rest.search(/^##\s+/m);
      const body = (next === -1 ? rest : rest.slice(0, next)).trim();

      const waived = /(^|\n)\s*Waived:\s*\S/i.test(body);
      const hasCitation = /https?:\/\/\S+/.test(body);
      const noneFound = /\bno\s+comparable\b|\bnone\s+found\b|no\s+(direct\s+)?prior[- ]?art/i.test(
        body,
      );

      if (waived) continue; // explicit opt-out
      if (body.length < 40 || (!hasCitation && !noneFound)) {
        findings.push(
          `${rel}: "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.`,
        );
      }
    }
  }

  return findings;
}

export function main() {
  const findings = collectSpecResearchFindings();

  if (findings.length > 0) {
    console.error('spec-research scan: FINDINGS');
    for (const f of findings) console.error('  - ' + f);
    console.error(
      '\nSee .agents/rules/research.md — prior-art research is default-on; opt out only via an explicit "Waived: <reason>".',
    );
    process.exit(1);
  }

  console.log('spec-research scan passed.');
  process.exit(0);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
