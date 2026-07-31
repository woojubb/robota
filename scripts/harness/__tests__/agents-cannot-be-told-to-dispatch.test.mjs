import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const AGENTS_DIR = path.join(WORKSPACE_ROOT, '.claude/agents');

/**
 * An agent that carries no `Agent` tool cannot dispatch another agent. Telling it to is a dead
 * instruction — it reads as enforced and has no execution path.
 *
 * This is the repository's dominant defect (PROC-003) at the agent layer, and it recurred THREE
 * times inside the single change that introduced the depth guardian: `architecture-fixer` and
 * `architecture-implementer` were told to obtain a verdict their pipeline never produced, and
 * `ci-failure-triager` was told to hand a finding to a guardian it cannot call. Each was written in
 * good faith, each read as a safety property, and none of the three could run.
 *
 * Prose caught two of them and a reviewer caught the third. This catches the fourth.
 *
 * What it asks: if an agent definition names a REGISTERED AGENT in an imperative — dispatch it, call
 * it, hand something to it, ask it — then either that agent carries `Agent` in its `tools`, or the
 * sentence must say what it EMITS instead of who it calls. The second form is usually the right one:
 * a judging agent that reports a signal keeps its read-only scope and lets the orchestrator route.
 */
const DEFINITIONS = readdirSync(AGENTS_DIR)
  .filter((n) => n.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(path.join(AGENTS_DIR, name), 'utf8') }));

const AGENT_NAMES = DEFINITIONS.map((d) => d.name.replace(/\.md$/, ''));

/** `tools:` from the frontmatter, as a list. */
function toolsOf(text) {
  const m = text.match(/^tools:[ \t]*(.+)$/m);
  if (!m) return [];
  return m[1]
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Sentences that tell this agent to make ANOTHER agent act. Comments and the "who owns what" prose
 * both mention other agents constantly, so the verb is what distinguishes an instruction from a
 * reference — and the verb has to be adjacent to the name, not merely in the same paragraph.
 */
const DISPATCH_VERBS =
  '\\b(?:dispatch|call|invoke|spawn|ask)\\b|\\bhand (?:it|this|the [a-z ]+) to\\b';

/**
 * Scoped to a SENTENCE, not a line. These documents wrap prose by hand at about 110 characters, so a
 * dispatch verb and the agent name land on different lines routinely — a line-scoped match misses
 * exactly the class this guards, which is the false-negative half. Newlines are folded to spaces and
 * the text is split on sentence ends instead.
 *
 * The verbs carry word boundaries for the other half: without them `call` matches inside `recall`
 * and `ask` inside `task`, and an ordinary sentence near an agent name fails CI for nothing. A floor
 * that cries wolf is one somebody switches off.
 */
export function dispatchInstructions(text, agentNames, selfName) {
  const found = [];
  const sentences = text
    .replace(/\r?\n/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  for (const sentence of sentences) {
    // A sentence that merely says what the OTHER agent owns is a reference, not an instruction.
    if (/\bowns\b|\bis the\b|\bthat is\b|\bbelongs to\b/i.test(sentence)) continue;
    for (const other of agentNames) {
      if (other === selfName) continue;
      const near = new RegExp(`(?:${DISPATCH_VERBS})[^.\`]{0,40}\`?${other}\`?`, 'i');
      if (near.test(sentence)) found.push({ other, line: sentence.trim() });
    }
  }
  return found;
}

describe('an agent is not told to do what it has no tool to do', () => {
  it('finds agent definitions to check', () => {
    // Fail closed: a moved directory would make every case below pass over nothing.
    expect(DEFINITIONS.length).toBeGreaterThan(5);
    expect(AGENT_NAMES).toContain('finding-depth-triager');
  });

  for (const { name, text } of DEFINITIONS) {
    it(`${name} carries the tool for what it is told to do`, () => {
      const self = name.replace(/\.md$/, '');
      const instructions = dispatchInstructions(text, AGENT_NAMES, self);
      if (instructions.length === 0) return;

      expect(
        toolsOf(text),
        `${name} is told to make another agent act — ${instructions
          .map((i) => `"${i.line}"`)
          .join('; ')} — but carries no Agent tool, so the instruction has no execution path. ` +
          'Either give it the tool, or say what it EMITS and let its caller route on that.',
      ).toContain('Agent');
    });
  }

  it('is not fooled by a line break, and not tripped by a word that contains a verb', () => {
    // Both halves of the same reading. These agent docs wrap prose at about 110 characters by hand,
    // so a dispatch verb and the agent name land on different LINES routinely — a line-scoped match
    // misses it, which is a false negative of the very class this guards. And `call`/`ask` without a
    // word boundary match inside `recall`, `called`, `task`, so an ordinary sentence near an agent
    // name would fail CI for nothing. A floor that cries wolf is one somebody switches off.
    const names = ['architecture-implementer'];

    expect(
      dispatchInstructions(
        'Dispatch\n`architecture-implementer` on the code-side findings.',
        names,
        'x',
      ),
      'a wrapped instruction was missed',
    ).toHaveLength(1);
    expect(
      dispatchInstructions(
        'the task assignment for `architecture-implementer` is separate',
        names,
        'x',
      ),
      '"task" was read as "ask"',
    ).toHaveLength(0);
    expect(
      dispatchInstructions('recall what `architecture-implementer` reported', names, 'x'),
      '"recall" was read as "call"',
    ).toHaveLength(0);
  });

  it('reads an instruction as an instruction and a reference as a reference', () => {
    // The distinction this rests on, pinned. Without it the check either fires on every agent that
    // mentions another (useless) or on none (decorative).
    const names = ['finding-depth-triager'];

    expect(
      dispatchInstructions('Dispatch `finding-depth-triager` on the findings.', names, 'x'),
    ).toHaveLength(1);
    expect(
      dispatchInstructions('hand the finding to `finding-depth-triager` first', names, 'x'),
    ).toHaveLength(1);
    expect(
      dispatchInstructions(
        '`finding-depth-triager` owns the verdict; you own the class.',
        names,
        'x',
      ),
    ).toHaveLength(0);
    expect(
      dispatchInstructions('The verdict is `finding-depth-triager`s, not yours.', names, 'x'),
    ).toHaveLength(0);
  });
});
