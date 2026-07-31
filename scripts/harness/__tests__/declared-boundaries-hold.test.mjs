import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const SKILLS_DIR = path.join(WORKSPACE_ROOT, '.agents/skills');

/**
 * A skill that declares "not my job — X's" must not then instruct itself to do it.
 *
 * The declaration is the repository's own convention: fourteen skills carry a
 * "What This Skill Does NOT Do" table naming an action and its owner. Nothing checked that the body
 * agreed with the table, and the body is what an agent follows.
 *
 * Measured 2026-08-01 in #1546: `pr-review-orchestration` told itself to post replies to the PR while
 * its own table said posting belongs to `pr-review-writer`, its header said it "does not review,
 * write, fix, or judge", and its closing line said to stop if you find yourself doing any of them.
 * Three statements of the boundary in one file, and the procedure between them crossed it.
 *
 * That was the fourth spelling of one habit in a single change — an instruction with no execution
 * path, a judgement with no actor, a registry disagreeing with its wiring, and a role writing outside
 * itself. Each looked different; each came from writing what should happen without asking who does it.
 *
 * What this checks is narrow and mechanical: the ACTION named in the table, appearing as an
 * imperative in the body. It does not attempt to judge whether the boundary is the right one.
 */
const SKILLS = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ name: e.name, file: path.join(SKILLS_DIR, e.name, 'SKILL.md') }))
  .filter((s) => existsSync(s.file))
  .map((s) => ({ ...s, text: readFileSync(s.file, 'utf8') }));

/**
 * Verb families, because the table and the body do not use the same word — and that is exactly how
 * the measured breach got through a first version of this check. The table said "Post the review to
 * the PR"; the procedure said "then reply". A first-word match saw two different verbs and passed.
 *
 * Only PERFORMABLE actions are covered. Most rows in these tables read "Define ..." or "Decide ..." —
 * those are statements about who owns a POLICY, and a routing skill referring to one is not doing it.
 * Narrow and stated, rather than broad and noisy.
 */
const ACTION_FAMILIES = [
  {
    key: 'post',
    verbs: [
      'post',
      'posts',
      'posting',
      'comment',
      'comments',
      'reply',
      'replies',
      'replying',
      'publish',
    ],
  },
  {
    key: 'edit',
    verbs: ['edit', 'edits', 'editing', 'fix', 'fixes', 'fixing', 'patch', 'patches'],
  },
  { key: 'push', verbs: ['push', 'pushes', 'pushing'] },
  { key: 'merge', verbs: ['merge', 'merges', 'merging'] },
  {
    key: 'author',
    verbs: ['author', 'authors', 'authoring', 'write', 'writes', 'writing', 'draft', 'drafts'],
  },
];

function familyFor(action) {
  const words = action
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (const family of ACTION_FAMILIES) {
    if (words.some((w) => family.verbs.includes(w))) return family;
  }
  return null;
}

/**
 * The actions a skill declares are not its own, read from its "does NOT do" table. The first column
 * is the action; the second is the owner. Only rows naming a DIFFERENT owner count, and only rows
 * whose action is performable — see ACTION_FAMILIES.
 */
export function disownedActions(text) {
  const start = text.indexOf('## What This Skill Does NOT Do');
  if (start === -1) return [];
  const rest = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, rest === -1 ? undefined : rest);
  const rows = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m) continue;
    const [, action, owner] = m;
    if (/^-+$/.test(action) || /^not this/i.test(action)) continue;
    const ownerAgent = owner.match(/`([a-z0-9-]+)`/);
    if (!ownerAgent) continue;
    const family = familyFor(action);
    if (!family) continue;
    rows.push({ action, owner: ownerAgent[1], family: family.key });
  }
  return rows;
}

/**
 * Does the body tell the skill to perform this action ITSELF?
 *
 * The distinguishing mark is an imperative with no dispatch to the owner in the same sentence.
 * "Hand the decision to `pr-review-writer` to post" is routing; "then reply" is doing.
 */
export function selfInstructions(text, action, owner) {
  const family = familyFor(action);
  if (!family) return [];
  const alt = family.verbs.join('|');
  const cut = text.indexOf('## What This Skill Does NOT Do');
  const body = cut === -1 ? text : text.slice(0, cut);
  const found = [];
  for (const sentence of body
    .replace(/\r?\n/g, ' ')
    .split(/(?<=[.!?][*_`)\]]{0,3})\s+/)
    .filter(Boolean)) {
    // Routing to the owner in the same sentence is the correct shape, not a violation.
    if (sentence.includes(owner)) continue;
    // A sentence ABOUT the boundary is not a breach of it.
    if (/\bnot\b|\bnever\b|\bdoes not\b|\bbelongs to\b|\bowner\b|\bis the\b/i.test(sentence))
      continue;
    // An imperative: the verb opens a clause rather than sitting inside a noun phrase.
    if (!new RegExp(`(^|[.;:—]\\s*|\\bthen\\s+|\\*\\*)(${alt})\\b`, 'i').test(sentence)) continue;
    found.push(sentence.trim());
  }
  return found;
}

describe('a skill does not instruct itself to do what it disowned', () => {
  it('finds skills that declare a boundary', () => {
    // Fail closed: if the table convention is renamed, every case below passes over nothing.
    const declaring = SKILLS.filter((s) => disownedActions(s.text).length > 0);

    // Five, not fourteen: most rows in these tables are "Define …" / "Decide …", which state who owns
    // a POLICY. Only a performable action can be crossed by a procedure, so only those are scanned —
    // and the number is asserted so a narrowing that quietly emptied the set would fail here.
    expect(declaring.length).toBeGreaterThanOrEqual(5);
    expect(declaring.map((s) => s.name)).toContain('pr-review-orchestration');
  });

  for (const skill of SKILLS) {
    const rows = disownedActions(skill.text);
    if (rows.length === 0) continue;
    it(`${skill.name} keeps the boundary it declares`, () => {
      const breaches = rows.flatMap((r) =>
        selfInstructions(skill.text, r.action, r.owner).map((s) => ({ ...r, sentence: s })),
      );

      expect(
        breaches.map((b) => `"${b.action}" is ${b.owner}'s, yet: ${b.sentence}`),
        'the body instructs an action the table gives away. Route it to the owner, or change the ' +
          'table — a boundary declared in three places and crossed in the procedure between them is ' +
          'worse than one never declared, because readers trust the declaration.',
      ).toEqual([]);
    });
  }

  it('tells routing apart from doing', () => {
    // The distinction this rests on, pinned. Without it the check fires on every skill that mentions
    // an action (useless) or on none (decorative).
    const table =
      "## What This Skill Does NOT Do\n\n| Not this skill's job | Owner |\n| --- | --- |\n| Post the review to the PR | `pr-review-writer` (worker) |\n";

    expect(disownedActions(table)).toEqual([
      { action: 'Post the review to the PR', owner: 'pr-review-writer', family: 'post' },
    ]);
    expect(
      selfInstructions(
        'Post it to the PR yourself. ' + table,
        'Post the review',
        'pr-review-writer',
      ),
      'a bare imperative was not read as doing',
    ).toHaveLength(1);
    expect(
      selfInstructions(
        'Hand the decision to `pr-review-writer` to post. ' + table,
        'Post the review',
        'pr-review-writer',
      ),
      'routing to the owner was read as doing',
    ).toHaveLength(0);
    expect(
      selfInstructions(
        "Posting is not this skill's job. " + table,
        'Post the review',
        'pr-review-writer',
      ),
      'a sentence about the boundary was read as breaching it',
    ).toHaveLength(0);
  });
});
