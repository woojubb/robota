#!/usr/bin/env node

/**
 * Agent-definition convention guard (INFRA-030).
 *
 * Mechanizes the "correct agent shape" contract registered in
 * `.agents/specs/document-standards/index.md` (document type: "agent definition"). No scan previously
 * read `.claude/agents/*.md`, so a new agent could be non-neutral, over-scoped, missing its terminal
 * machine-signal, or unregistered and nothing failed. This guard is the missing enforcement half.
 *
 * For each `.claude/agents/*.md` it asserts:
 *
 *   1. Frontmatter has `name`, `description`, `tools`.
 *   2. Tool-scope is consistent with a declared read-only role: an agent whose `description` declares it
 *      read-only must NOT carry `Edit`/`Write` in `tools`.
 *   3. Signal-bearing agents (classified by the PRESENCE of a `signal:` frontmatter field — never by
 *      tool-absence) declare a token from the CLOSED vocabulary and their body's output-contract
 *      instructs ending with that exact token (the token string appears in the body).
 *   4. The agent is referenced in `.agents/skills/index.md` (registered, not orphaned).
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const AGENTS_DIR = path.join(WORKSPACE_ROOT, '.claude/agents');
const SKILLS_INDEX = path.join(WORKSPACE_ROOT, '.agents/skills/index.md');

/** The closed vocabulary of terminal machine-signals an agent may declare. */
export const CLOSED_SIGNAL_VOCAB = new Set([
  'ACTIONABLE FINDINGS',
  'REVIEW VERDICT',
  'MERGE VERIFIED',
  'DECOMPOSITION',
  'PRIOR_ART_RESEARCH',
]);

const EDIT_TOOLS = ['Edit', 'Write'];

/** Split a markdown file into its YAML-ish frontmatter map + body. */
export function parseAgentFile(text) {
  const map = {};
  let body = text;
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    body = text.slice(fmMatch[0].length);
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
      if (m) map[m[1].trim()] = m[2].trim();
    }
  }
  return { frontmatter: map, body };
}

/**
 * Analyze one agent definition. `referencedInIndex` is whether the agent's name appears in the skills
 * index. Returns an array of finding strings (empty = conforms). Exported for the fixture self-test.
 */
export function analyzeAgent(text, { referencedInIndex = true } = {}) {
  const findings = [];
  const { frontmatter, body } = parseAgentFile(text);

  for (const key of ['name', 'description', 'tools']) {
    if (!frontmatter[key]) findings.push(`missing frontmatter field: ${key}`);
  }

  const tools = (frontmatter.tools ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const isDeclaredReadOnly = /read-only/i.test(frontmatter.description ?? '');
  if (isDeclaredReadOnly) {
    const carried = EDIT_TOOLS.filter((t) => tools.includes(t));
    if (carried.length > 0) {
      findings.push(`declares itself read-only but carries edit tool(s): ${carried.join(', ')}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(frontmatter, 'signal')) {
    const token = frontmatter.signal;
    if (!CLOSED_SIGNAL_VOCAB.has(token)) {
      findings.push(
        `signal "${token}" is not in the closed vocabulary (${[...CLOSED_SIGNAL_VOCAB].join(' | ')})`,
      );
    } else if (!body.includes(token)) {
      findings.push(
        `declares signal "${token}" but its body's output-contract does not instruct ending with that token`,
      );
    }
  }

  if (!referencedInIndex) {
    findings.push('not referenced in .agents/skills/index.md (unregistered agent)');
  }

  return findings;
}

export function findAgentDefFindings(agentsDir = AGENTS_DIR, skillsIndexPath = SKILLS_INDEX) {
  const results = [];
  if (!existsSync(agentsDir)) return results;
  const indexText = existsSync(skillsIndexPath) ? readFileSync(skillsIndexPath, 'utf8') : '';
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const text = readFileSync(path.join(agentsDir, entry.name), 'utf8');
    const { frontmatter } = parseAgentFile(text);
    const agentName = frontmatter.name || entry.name.replace(/\.md$/, '');
    const referencedInIndex = indexText.includes(agentName);
    const findings = analyzeAgent(text, { referencedInIndex });
    if (findings.length > 0) results.push({ file: entry.name, findings });
  }
  return results;
}

function main() {
  const results = findAgentDefFindings();
  if (results.length === 0) {
    console.log('✅ Agent-definition convention: all agents conform.');
    console.log('agent-def-convention summary: violations=0 result=PASS');
    process.exit(0);
  }
  console.error('❌ Agent-definition convention violations found:\n');
  let count = 0;
  for (const { file, findings } of results) {
    for (const f of findings) {
      console.error(`  [agent-def] ${file}: ${f}`);
      count += 1;
    }
  }
  console.error('');
  console.error(`agent-def-convention summary: violations=${count} result=FAIL`);
  process.exit(1);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  main();
}
