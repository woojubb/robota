#!/usr/bin/env node

/**
 * A loop that cannot notice it is stuck, and a registry that disagrees with the loop it registers.
 *
 * Two failures with one cause, which is why one scan reads both. A convergence loop re-drives until
 * something is gone; whether it can tell a stuck round from a productive one depends on what a round
 * PRODUCES, and that fact was written twice — once in the skill and once in the orchestration map —
 * so the two could disagree, and did.
 *
 * WHAT A ROUND PRODUCES DECIDES THE BOUND. Two kinds, declared rather than inferred:
 *
 *  - `over=finding-set` — the round returns findings. A count cannot see this loop stuck, because a
 *    stuck round and a productive one look identical to a counter and different to the finding set.
 *    It MUST declare `escape=no-progress`, and its BODY must say so, because a declaration nothing
 *    implements is the dodge this repository already has a separate floor about.
 *  - `over=attempt` — the round retries one action that either succeeds or does not: re-cutting a
 *    base, re-running a phase, asking a person for a fresh credential. There is no set to compare, so
 *    a COUNT is the right bound and the only one available, and it must be a NUMBER. Demanding an
 *    escape here would be a check firing on a correct state.
 *  - `over=delegated; owner=<skill>` — the skill REFERS to a loop it does not drive. It carries no
 *    bound of its own, and the skill it names must exist and declare one. This exists because the
 *    sweep below is deliberately broad, and a broad sweep catches references as well as loops; the
 *    answer is to make the reference explicit rather than to narrow the sweep until it starts missing
 *    real loops again.
 *
 * THE POPULATION IS ESTABLISHED HERE, NOT KEPT BY HAND. Every skill whose body describes a re-driven
 * loop must carry the declaration. A hand-kept list of which skills have loops was corrected five
 * times in five review rounds before this scan existed; a list nobody can recount is a list that is
 * wrong the moment a skill is added.
 *
 * AND THE MAP MUST AGREE. `orchestration-map.md` states a Loop-back bound per pipeline in its own
 * words, next to the skill that owns it — two statements of one fact, which is what diverges. The
 * map's header already claims it is mechanically kept current; this is the part that makes that true
 * for the column where the divergence happened.
 *
 * Exit 0 = every loop declares its kind, implements what it declares, and matches the map.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const SKILLS_DIR = '.agents/skills';
const MAP_PATH = '.agents/specs/orchestration-map.md';

/**
 * Phrases that mean "this skill re-drives something".
 *
 * Deliberately broad, and its breadth is the point: a keyword sweep that misses a phrasing reports
 * the absence of what it cannot see, which is the exact failure this scan exists to end. A skill
 * swept in wrongly declares `over=attempt` and is answered; a skill missed is never asked.
 */
const LOOP_LANGUAGE =
  /auto-re-drive|re-drives?\b|bounded iterations|Bounded:|bounded at|bounded to|round cap|loop until|repeats? until|loop repeats|\*\*Loop\*\*|verification loop|repeat phase|Back to Step/i;

const DECLARATION = /^loop:\s*(.+)$/m;

/** The escape, as a body must state it. Any of these; the rule owns what the comparison means. */
const ESCAPE_IN_BODY = /recurs? unchanged|recurred unchanged|fail unchanged|no-progress/i;

export function parseDeclaration(text) {
  const match = DECLARATION.exec(frontmatterOf(text));
  if (!match) return undefined;
  const fields = {};
  for (const part of match[1].split(';')) {
    const [key, ...rest] = part.split('=');
    if (rest.length === 0) continue;
    fields[key.trim()] = rest.join('=').trim();
  }
  return fields;
}

function frontmatterOf(text) {
  if (!text.startsWith('---\n')) return '';
  const end = text.indexOf('\n---\n', 4);
  return end === -1 ? '' : text.slice(4, end);
}

function bodyOf(text) {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 4);
  return end === -1 ? text : text.slice(end + 5);
}

/** The Loop-back cell of `orchestration-map.md`, per skill named in the row's orchestrator column. */
export function readMapBounds(source) {
  const bounds = new Map();
  for (const line of source.split('\n')) {
    if (!line.startsWith('| **')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 7) continue;
    const [, , orchestrator, , , loopBack] = cells;
    for (const skill of orchestrator.matchAll(/`([a-z0-9-]+)`/g)) {
      // First mention wins: a row names its orchestrator first and its collaborators after.
      if (!bounds.has(skill[1])) bounds.set(skill[1], loopBack);
    }
  }
  return bounds;
}

export function judgeSkill({ name, text, mapBound, ownerExists = () => true }) {
  const findings = [];
  const body = bodyOf(text);
  if (!LOOP_LANGUAGE.test(body)) return findings;

  const declared = parseDeclaration(text);
  if (!declared) {
    findings.push({
      skill: name,
      kind: 'undeclared-loop',
      detail:
        'the body describes a re-driven loop and the frontmatter declares no `loop:` line, so nothing ' +
        'can tell whether a count is the right bound for it.',
    });
    return findings;
  }

  const over = declared.over;
  if (over !== 'finding-set' && over !== 'attempt' && over !== 'delegated') {
    findings.push({
      skill: name,
      kind: 'unknown-loop-kind',
      detail: `\`over=${over ?? '(missing)'}\` is not a kind. Use \`finding-set\`, \`attempt\` or \`delegated\`.`,
    });
    return findings;
  }

  if (over === 'delegated') {
    // The owner has to resolve, or "someone else bounds this" is a claim about nothing — the same
    // reason a citation in a rule must link to a record that exists.
    if (!declared.owner || !ownerExists(declared.owner)) {
      findings.push({
        skill: name,
        kind: 'delegated-to-nothing',
        detail: `\`owner=${declared.owner ?? '(missing)'}\` names no skill that declares a loop, so nothing bounds what this defers.`,
      });
    }
    return findings;
  }

  if (over === 'finding-set') {
    if (declared.escape !== 'no-progress') {
      findings.push({
        skill: name,
        kind: 'no-escape-declared',
        detail:
          'a loop over a finding set declares no `escape=no-progress`. A count cannot see it stuck: a ' +
          'stuck round and a productive one are identical to a counter and different to the findings.',
      });
    } else if (!ESCAPE_IN_BODY.test(body)) {
      findings.push({
        skill: name,
        kind: 'escape-declared-not-stated',
        detail:
          'the frontmatter declares `escape=no-progress` and the body never says what happens when a ' +
          'round returns the same findings. A declaration nothing implements is not an escape.',
      });
    }
  }

  if (over === 'attempt' && !/\d/.test(declared.bound ?? '')) {
    findings.push({
      skill: name,
      kind: 'attempt-loop-without-a-number',
      detail:
        'a loop over attempts has no finding set to compare, so a COUNT is its only available bound — ' +
        `and \`bound=${declared.bound ?? '(missing)'}\` states no number. "Bounded" with no number is not a bound.`,
    });
  }

  // The map restates the bound. Agreement is checked on the DECLARED escape and number, not on the
  // map's prose, because the map is free to say it in its own words and must not be free to say
  // something else.
  if (mapBound !== undefined) {
    if (declared.escape === 'no-progress' && !/progress/i.test(mapBound)) {
      findings.push({
        skill: name,
        kind: 'map-understates-the-escape',
        detail: `the map's Loop-back cell — "${mapBound}" — does not mention progress detection, which this skill declares.`,
      });
    }
    const declaredNumber = /(\d+)/.exec(declared.bound ?? '')?.[1];
    if (declaredNumber && !mapBound.includes(declaredNumber)) {
      findings.push({
        skill: name,
        kind: 'map-disagrees-on-the-bound',
        detail: `the skill declares \`bound=${declared.bound}\`; the map's cell — "${mapBound}" — does not carry ${declaredNumber}.`,
      });
    }
  }

  return findings;
}

export function scanLoops(root = WORKSPACE_ROOT) {
  const skillsDir = path.join(root, SKILLS_DIR);
  const mapFile = path.join(root, MAP_PATH);
  // Fail closed on both inputs. A population read from a directory that is not there is empty, and an
  // empty population is a pass that examined nothing.
  if (!existsSync(skillsDir))
    throw new Error(`loop-contract: ${SKILLS_DIR} does not exist under ${root}.`);
  if (!existsSync(mapFile))
    throw new Error(`loop-contract: ${MAP_PATH} does not exist under ${root}.`);

  const mapBounds = readMapBounds(readFileSync(mapFile, 'utf8'));
  if (mapBounds.size === 0) {
    throw new Error(
      `loop-contract: ${MAP_PATH} yielded no pipeline rows — its table shape changed.`,
    );
  }

  const names = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .sort();
  if (names.length === 0)
    throw new Error(`loop-contract: ${SKILLS_DIR} holds no skills to examine.`);

  const sources = new Map(
    names.map((name) => [name, readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8')]),
  );
  const declaresALoop = new Set(
    [...sources]
      .filter(([, text]) => ['finding-set', 'attempt'].includes(parseDeclaration(text)?.over))
      .map(([name]) => name),
  );

  const findings = [];
  let loops = 0;
  for (const name of names) {
    const text = sources.get(name);
    if (parseDeclaration(text) || LOOP_LANGUAGE.test(bodyOf(text))) loops += 1;
    findings.push(
      ...judgeSkill({
        name,
        text,
        mapBound: mapBounds.get(name),
        ownerExists: (owner) => declaresALoop.has(owner),
      }),
    );
  }
  return { findings, examined: names.length, loops };
}

function main() {
  const { findings, examined, loops } = scanLoops();
  for (const finding of findings) {
    console.error(`- [${finding.kind}] ${SKILLS_DIR}/${finding.skill}/SKILL.md: ${finding.detail}`);
  }
  if (findings.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `loop-contract scan passed (${examined} skill(s) examined; ${loops} declare a loop, each ` +
      'implementing the escape it declares and agreeing with the orchestration map).',
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
