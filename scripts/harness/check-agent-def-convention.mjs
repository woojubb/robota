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
 *   5. A FINDING-PRODUCING agent (classified by its `signal:` token) references the finding-depth
 *      rule, so "is this finding in scope, or a separate root item?" has an owner other than the
 *      agent that wants to absorb it.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// HARNESS-046: frontmatter is read by the harness's ONE parser. `tools:` is legitimately a YAML flow
// array, and prettier reflows a long one onto several indented lines — which the hand-rolled per-line
// regex this replaced read as '', blinding the read-only/edit-tool check entirely.
import { asScalar, isBlank, splitFrontmatter } from './frontmatter.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const AGENTS_DIR = path.join(WORKSPACE_ROOT, '.claude/agents');
const SKILLS_INDEX = path.join(WORKSPACE_ROOT, '.agents/skills/index.md');

/**
 * The closed vocabulary of terminal machine-signals an agent may declare.
 *
 * Adding a token here is what makes an agent able to DECLARE it in `signal:` frontmatter — an
 * unregistered token fails this guard, so an agent that emits one has to omit the field, and the
 * orchestration map then records a signal nothing can mechanically check. The last three were
 * shipped by HARNESS-049 increments that could not edit `scripts/**` (file ownership) and so were
 * left unregistered; registered here (INFRA-048-D).
 */
export const CLOSED_SIGNAL_VOCAB = new Set([
  'ACTIONABLE FINDINGS',
  'REVIEW VERDICT',
  'MERGE VERIFIED',
  'DECOMPOSITION',
  'PRIOR_ART_RESEARCH',
  'CI TRIAGE',
  'GATE VERDICT',
  'SCENARIO DRAFTED',
  'DEPTH',
  'AUDIT-DIM-COMPLETE',
  'SYNTH',
  'VERIFY',
  'RECONCILE',
]);

const EDIT_TOOLS = ['Edit', 'Write'];

/**
 * The signals whose bearers PRODUCE FINDINGS — open-ended judgements about a body of work, where
 * "does this finding belong to the thing under review?" is a live question every time.
 *
 * Deliberately excluded, and why, so the set is not widened by reflex:
 * - `GATE VERDICT` — its bearers (the worktree gates, the backlog gate guard) judge a named gate
 *   against fixed criteria and answer PASS/FAIL/NON-COMPLIANCE. There is no finding whose scope could
 *   expand, so requiring the reference would be ceremony. Adding them was this guard's own first
 *   draft, and it was over-reach of exactly the kind the guard exists to catch.
 * - `DECOMPOSITION`, `PRIOR_ART_RESEARCH`, `SCENARIO DRAFTED` — produce an artifact, judge nothing.
 * - `MERGE VERIFIED`, `CI TRIAGE` — report a state.
 * - `DEPTH` — its bearer IS the depth judge; requiring it to cite the rule it implements is circular.
 * - `VERIFY` — tests the truth of one already-scoped finding.
 * - `RECONCILE` — matches an already-FOUNDATIONAL finding to the live registries after depth is settled.
 */
const FINDING_PRODUCING_SIGNALS = new Set([
  'REVIEW VERDICT',
  'ACTIONABLE FINDINGS',
  'AUDIT-DIM-COMPLETE',
  'SYNTH',
]);

/**
 * Split a markdown file into its frontmatter map + body. Values are a string (scalar) or a
 * string[] (`tools: [Read, Write]`, in any of the shapes prettier may leave it in).
 */
/**
 * How many agent definitions the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases (HARNESS-057). RESET at the top of the walk, so a run that reads nothing cannot report the
 * previous run's number.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export function parseAgentFile(text) {
  const { entries, body } = splitFrontmatter(text);
  return { frontmatter: entries ? Object.fromEntries(entries) : {}, body };
}

/**
 * Analyze one agent definition. `referencedInIndex` is whether the agent's name appears in the skills
 * index. Returns an array of finding strings (empty = conforms). Exported for the fixture self-test.
 */
export function analyzeAgent(text, { referencedInIndex = true } = {}) {
  const findings = [];
  const { frontmatter, body } = parseAgentFile(text);

  for (const key of ['name', 'description', 'tools']) {
    if (isBlank(frontmatter[key])) findings.push(`missing frontmatter field: ${key}`);
  }

  // `tools` is either a flow/block sequence (already a list) or the comma-separated scalar form.
  const tools = Array.isArray(frontmatter.tools)
    ? frontmatter.tools
    : asScalar(frontmatter.tools)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
  const isDeclaredReadOnly = /read-only/i.test(asScalar(frontmatter.description));
  if (isDeclaredReadOnly) {
    const carried = EDIT_TOOLS.filter((t) => tools.includes(t));
    if (carried.length > 0) {
      findings.push(`declares itself read-only but carries edit tool(s): ${carried.join(', ')}`);
    }
    // HARNESS-DIET-001: `Bash` cannot be sub-scoped to read-only git subcommands, so a read-only agent that
    // carries Bash CAN run `git reset --hard`/`checkout`/`clean` and destroy uncommitted work (this happened
    // in-session). Require an explicit tree-mutating-git guardrail in the body as the mechanical floor.
    if (tools.includes('Bash') && !/tree-mutating git/i.test(body)) {
      findings.push(
        'read-only agent carries Bash but its body does not forbid tree-mutating git — add the guardrail (the phrase "tree-mutating git"); see HARNESS-DIET-001',
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(frontmatter, 'signal')) {
    const token = asScalar(frontmatter.signal);
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

  // An agent that RETURNS A VERDICT on findings decides, implicitly, which findings belong to the
  // thing under review and which are separate root items. That is the depth question, and it has its
  // own owner document. `proposal-reviewer` shipped without referencing it and, across a twelve-round
  // review, defaulted to absorption every time — growing one item's `area` from three packages to
  // thirteen with nobody deciding that it should grow. Ten of the eleven finding-producing agents
  // already carried the reference; the guard is what makes that a floor instead of a habit.
  if (
    FINDING_PRODUCING_SIGNALS.has(asScalar(frontmatter.signal) ?? '') &&
    !/finding-depth/.test(body)
  ) {
    findings.push(
      'produces findings but its body never references the finding-depth rule — a finding-producing agent must say which findings are in scope and which are separate root items, and that convention is owned by finding-depth.md, not by the agent',
    );
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
    examinedCount += 1;
    const text = readFileSync(path.join(agentsDir, entry.name), 'utf8');
    const { frontmatter } = parseAgentFile(text);
    const agentName = asScalar(frontmatter.name) || entry.name.replace(/\.md$/, '');
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
    console.log(`::examined:: ${examinedCount} agent definitions`);
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
