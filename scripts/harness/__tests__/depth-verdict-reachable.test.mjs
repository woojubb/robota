import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRootItems } from '../record-local-review.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const AGENTS_DIR = path.join(WORKSPACE_ROOT, '.claude/agents');
const SKILLS_DIR = path.join(WORKSPACE_ROOT, '.agents/skills');
const MAP = path.join(WORKSPACE_ROOT, '.agents/specs/orchestration-map.md');
const BACKLOG_DIR = path.join(WORKSPACE_ROOT, '.agents/backlog');

/**
 * A worker told to TAKE a depth verdict must have a pipeline that PRODUCES one.
 *
 * `finding-depth.md` puts the verdict with a guardian and the taking with the worker, which is the
 * right split and also a shape this repository has repeatedly got wrong: the worker carries no
 * `Agent` tool, so it cannot obtain the verdict itself, and if no pipeline hands it one the
 * instruction reads as enforced while nothing can ever satisfy it. Measured 2026-08-01 in #1546 —
 * `architecture-fixer` and `architecture-implementer` shipped with exactly that hole and it was
 * closed by prose, twice, before anything checked it.
 *
 * PROC-005 is the same hole one pipeline over. `doc-fixer` was deliberately left un-wired while the
 * question "what does a foundational DOCUMENTATION finding even mean" was open; wiring it without
 * this check would have re-created the defect the wiring is supposed to remove, since the whole
 * dispatch is one line of markdown that a later edit can drop with nothing failing.
 *
 * This is a reachability floor, not anti-rot: it does not ask whether a file mentions a concept, it
 * asks whether a stated instruction has an actor that can satisfy it.
 */

const DEFINITIONS = readdirSync(AGENTS_DIR)
  .filter((n) => n.endsWith('.md'))
  .map((name) => ({
    name: name.replace(/\.md$/, ''),
    text: readFileSync(path.join(AGENTS_DIR, name), 'utf8'),
  }));

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
 * Does this body instruct the agent to RECEIVE a depth verdict rather than to produce one?
 *
 * The marker is a take-verb near the DEPTH token, because that is the sentence every wired site
 * actually writes ("Take the DEPTH verdict", "Take its `DEPTH:` line", "as handed to you"). It is a
 * prose predicate, and a prose predicate can stop matching when someone rewords the sentence — so
 * the pinned-membership case below asserts the known sites are still IN the set. A reword that
 * removes an agent from coverage fails there rather than silently narrowing this floor to nothing,
 * which is the way a check like this normally dies.
 */
export function takesDepthVerdict(text) {
  return /(?:\btakes?\b|\btaking\b|\btaken\b|handed to you|given to you)[^.]{0,90}\bDEPTH\b/i.test(
    text,
  );
}

/** Agents that take a verdict they cannot obtain themselves. The producer is excluded by name. */
export function depthTakingAgents(definitions) {
  return definitions
    .filter(({ name }) => name !== 'finding-depth-triager')
    .filter(({ text }) => takesDepthVerdict(text) && !toolsOf(text).includes('Agent'))
    .map(({ name }) => name)
    .sort();
}

const SKILLS = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ name: e.name, file: path.join(SKILLS_DIR, e.name, 'SKILL.md') }))
  .filter((s) => existsSync(s.file))
  .map((s) => ({ ...s, text: readFileSync(s.file, 'utf8') }));

/**
 * Skills that could hand this agent a verdict: ones naming BOTH the agent and the guardian.
 *
 * Deliberately weaker than `scan-orchestration-map`'s imperative reading, and the reason is measured
 * rather than convenient: that reader skips any sentence containing "is the", so it does not see
 * `pr-review-orchestration`'s own `finding-depth-triager` dispatch. Requiring it here would fail a
 * site that is correctly wired — the false-positive half, which is how a floor gets switched off.
 * Co-occurrence is enough for the property being checked, which is that SOME pipeline knows about
 * both ends. The narrower reading still applies, from that scan, to the map row.
 */
export function producingSkillsFor(agent, skills) {
  return skills
    .map((s) => ({ ...s, body: bodyOf(s.text) }))
    .filter((s) => s.body.includes(agent) && s.body.includes('finding-depth-triager'))
    .map((s) => s.name);
}

/**
 * The skill BODY — frontmatter excluded. A `description:` that names the guardian describes the
 * pipeline; the procedure is what an agent follows. Demonstrated while red-proving this file: with
 * the dispatch step deleted, the description alone still satisfied a whole-text match, which is the
 * declared-but-unreached shape the check exists to refuse.
 */
function bodyOf(text) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return m ? text.slice(m[0].length) : text;
}

describe('a worker told to take a depth verdict has a pipeline that produces one', () => {
  it('finds the definitions and skills to check', () => {
    // Fail closed: a moved directory would make every case below pass over nothing.
    expect(DEFINITIONS.length).toBeGreaterThan(5);
    expect(SKILLS.length).toBeGreaterThan(20);
  });

  it('keeps the known depth-taking workers inside the predicate', () => {
    // Anti-vacuity, and the honest weak point of a prose predicate: if a reword drops one of these
    // out of the set, the case below stops checking it and stays green. This one goes red instead.
    expect(depthTakingAgents(DEFINITIONS)).toEqual(
      expect.arrayContaining([
        'architecture-fixer',
        'architecture-implementer',
        'doc-fixer',
        'pr-review-fixer',
      ]),
    );
  });

  it.each(depthTakingAgents(DEFINITIONS))(
    '%s is dispatched by a pipeline that also dispatches the depth guardian',
    (agent) => {
      expect(
        producingSkillsFor(agent, SKILLS),
        `${agent} is instructed to take a DEPTH verdict, carries no Agent tool, and no skill both dispatches it and dispatches finding-depth-triager — the instruction has no execution path`,
      ).not.toEqual([]);
    },
  );

  it('records the depth guardian in the map row of every pipeline whose worker takes a verdict', () => {
    // The registry half. `scan-orchestration-map` already refuses a dispatch missing from its row;
    // this refuses the converse gap it cannot see — a row whose worker takes a verdict the row
    // does not show anyone producing. Two disagreeing halves of one wiring is the registry-drift
    // class, and the map is what a reader consults instead of reading four skills.
    const workers = depthTakingAgents(DEFINITIONS);
    const rows = readFileSync(MAP, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('|') && line.split('|').length > 5);

    for (const row of rows) {
      const cells = row.split('|');
      const workerCell = cells[3] ?? '';
      const guardianCell = cells[4] ?? '';
      const carried = workers.filter((w) => workerCell.includes(w));
      if (carried.length === 0) continue;
      expect(
        guardianCell,
        `the pipeline row for ${carried.join(', ')} lists no finding-depth-triager among its guardians`,
      ).toContain('finding-depth-triager');
    }
  });
});

/**
 * The document form of the containment label, and the same refusal `record-local-review` applies to
 * the code form: an ID that resolves to no filed item asserts a root item exists.
 *
 * A hold labelled with an item nobody filed is indistinguishable from having ignored the finding —
 * worse than leaving it visibly open, because the label is what stops the next audit round from
 * raising it again. So the label is only worth what it resolves to.
 */
export function containmentNotes(text) {
  const found = [];
  const pattern = /^>\s*\*\*Contained\s*[—-]\s*(?:\[)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+)/;
  // Fenced blocks are excluded, and this was not a refinement: the rule document that DEFINES the
  // convention shows it in a ```markdown fence, and the first run of this check failed on its own
  // illustration. A sample of a label is not a label, exactly as a code sample is not code.
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(pattern);
    if (m) found.push(m[1]);
  }
  return found;
}

describe('a containment note in a document names a root item that exists', () => {
  const trackedMarkdown = execFileSync('git', ['ls-files', '*.md'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);

  it('reads the tracked markdown tree', () => {
    // Fail closed (HARNESS-052): an empty listing must not read as "no unresolved labels".
    expect(trackedMarkdown.length).toBeGreaterThan(100);
    expect(existsSync(BACKLOG_DIR)).toBe(true);
  });

  it('parses the convention, and only the convention', () => {
    expect(containmentNotes('> **Contained — PROC-005.** why\n')).toEqual(['PROC-005']);
    expect(containmentNotes('> **Contained — [PROC-005](../backlog/x.md).** why\n')).toEqual([
      'PROC-005',
    ]);
    expect(containmentNotes('> **Contained — SELFHOST-008-P5-3.** why\n')).toEqual([
      'SELFHOST-008-P5-3',
    ]);
    // Not a note: prose about containment, and an HTML comment — the hidden form the convention
    // rejects, which must not be read as a valid label either.
    expect(containmentNotes('This section is contained under PROC-005.')).toEqual([]);
    expect(containmentNotes('<!-- Contained — PROC-005 -->')).toEqual([]);
    expect(
      containmentNotes('```markdown\n> **Contained — ARCH-042.** an example\n```\n'),
      'an illustration of the convention was read as a use of it',
    ).toEqual([]);
  });

  it('resolves every label in the tree to a filed backlog item', () => {
    const unresolved = [];
    for (const rel of trackedMarkdown) {
      const file = path.join(WORKSPACE_ROOT, rel);
      if (!existsSync(file)) continue;
      const ids = containmentNotes(readFileSync(file, 'utf8'));
      if (ids.length === 0) continue;
      const { missing } = resolveRootItems(ids, BACKLOG_DIR);
      for (const id of missing) unresolved.push(`${rel}: ${id}`);
    }

    expect(
      unresolved,
      'a containment note names a backlog item that does not exist — file the root item, or remove the label and leave the finding open',
    ).toEqual([]);
  });
});
