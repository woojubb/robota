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

import { asScalar, splitFrontmatter } from './frontmatter.mjs';
import { QUANTIFIED_BOUND } from './scan-loopback-bound-ownership.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const SKILLS_DIR = '.agents/skills';
const RULES_DIR = '.agents/rules';
/** The rule that owns the no-progress escape; every other loop states it or points here. */
const OWNER_RULE = 'enforcement-architecture.md';
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

/** The escape, as a body must state it. Any of these; the rule owns what the comparison means. */
const ESCAPE_IN_BODY = /recurs? unchanged|recurred unchanged|fail unchanged|no-progress/i;

/**
 * The `loop:` declaration, as fields.
 *
 * Read through `frontmatter.mjs`, which owns the `^<key>:` line regex for the whole harness. The
 * first version of this file hand-rolled that regex and slipped past the guard built to stop exactly
 * that, because the guard's key allowlist did not yet name `loop` — the fork and the hole in its
 * detector arriving together. A single-line regex also mis-reads a value a formatter has wrapped,
 * which is the defect the owner exists for.
 */
export function parseDeclaration(text) {
  const { entries } = splitFrontmatter(text);
  const declared = entries?.get('loop');
  if (declared === undefined) return undefined;

  const fields = {};
  for (const part of asScalar(declared).split(';')) {
    const [key, ...rest] = part.split('=');
    if (rest.length === 0) continue;
    fields[key.trim()] = rest.join('=').trim();
  }
  return fields;
}

/** The document beneath its frontmatter — the text a declared escape must actually appear in. */
function bodyOf(text) {
  return splitFrontmatter(text).body;
}

/**
 * The Loop-back cell of `orchestration-map.md`, per skill named in the row's orchestrator column.
 *
 * A row is OWNED by the first skill its orchestrator cell names; the others are collaborators it
 * hands to, and they inherit the row's bound only when they have no row of their own. Reading it
 * "first mention across the whole table wins" attributed a shared sub-orchestration to whichever row
 * happened to mention it first — measured here: a skill was judged against the PR-review row's cell
 * rather than its own, and a substring comparison hid the mismatch because that cell contained a
 * date whose digits matched.
 */
export function readMapBounds(source) {
  const owned = new Map();
  const inherited = new Map();
  for (const line of source.split('\n')) {
    if (!line.startsWith('| **')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 7) continue;
    const [, , orchestrator, , , loopBack] = cells;
    const named = [...orchestrator.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
    if (named.length === 0) continue;
    if (!owned.has(named[0])) owned.set(named[0], loopBack);
    for (const collaborator of named.slice(1)) {
      if (!inherited.has(collaborator)) inherited.set(collaborator, loopBack);
    }
  }
  return new Map([...inherited, ...owned]);
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
    // Matched on a WORD BOUNDARY, not as a substring. `'12'.includes('1')` is true, so a skill
    // declaring 1 round would have agreed with a map cell saying 12 — a silent disagreement, which is
    // the one thing this check exists to make impossible.
    //
    // A cell with NO number is the PREFERRED form, not a disagreement — HARNESS-072 (#1617). This
    // clause used to demand the map carry the skill's number, which is the two-copies design that
    // produced #1615's contradictions: a checker keeping two statements equal still leaves two
    // statements, and the round-8 incident was exactly the copy surviving an owner's change to the
    // original. The sibling `loopback-bound-ownership` scan now refuses a quantified bound in the
    // map at all; what remains THIS check's business is a cell that states a DIFFERENT number —
    // which is no longer drift waiting to happen but a live disagreement.
    // The number is read out of a QUANTIFIED BOUND, never out of the first digits in the cell —
    // `readMapBounds`' own history is a date's digits standing in for a bound, and a bare
    // `/(\d+)/` over the whole cell re-imports that class: an `owner directive 2026-08-03`
    // parenthetical would make the cell "say" 2026. One expression owns what counts as a
    // quantified bound; this clause reads the number from its match alone.
    const mapNumber = /(\d+)/.exec(QUANTIFIED_BOUND.exec(mapBound)?.[0] ?? '')?.[1];
    if (declaredNumber && mapNumber && mapNumber !== declaredNumber) {
      findings.push({
        skill: name,
        kind: 'map-disagrees-on-the-bound',
        detail: `the skill declares \`bound=${declared.bound}\`; the map's cell — "${mapBound}" — says ${mapNumber}.`,
      });
    }
  }

  return findings;
}

/**
 * A RULE may describe a loop too, and then it is bound by the same contract.
 *
 * This is where a rule-versus-rule contradiction actually arrived: one mandatory rule said "bounded
 * iterations, then escalate" — a count as the only bound — while another forbade exactly that, in
 * normative text, created by the change that landed the second. Rules outrank skills, so a reader
 * following the first was correct to ignore the second.
 *
 * A rule carries no frontmatter declaration, so the check is the one axis it can have: a rule that
 * describes a re-driven loop must say what a round that changes nothing does, or point at the rule
 * that owns the answer. That is narrower than "detect any contradiction between two rules", and it
 * is the shape the contradiction took.
 */
/**
 * The passages a rule is judged in.
 *
 * Blank lines are not enough. A bulleted list in these documents is ONE blank-line block, so a loop
 * bullet with no escape sat in the same passage as an unrelated bullet's link to the rule that owns
 * one — and the link would excuse it. That is the same "exemption granted by coincidence" this check
 * was corrected for once already, one level tighter. A list item is its own passage; its indented
 * continuation lines belong to it.
 */
export function passages(text) {
  const out = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    let current = null;
    for (const line of block.split('\n')) {
      // A LIST MARKER opens a new passage. Anything else continues the one in progress — including
      // the second line of an ordinary hard-wrapped paragraph, which the first version pushed as its
      // own passage. That inverted the defect: a paragraph stating a loop on one line and its escape
      // on the next was flagged for lacking what it said one wrap away.
      if (/^\s{0,3}(?:[-*+]|\d+\.)\s/.test(line)) {
        if (current !== null) out.push(current);
        current = line;
      } else {
        current = current === null ? line : `${current}\n${line}`;
      }
    }
    if (current !== null) out.push(current);
  }
  return out;
}

export function judgeRule({ name, text }) {
  const findings = [];
  // The rule that OWNS the escape states it once; demanding every paragraph of it restate the
  // definition would be the restatement defect this harness files items about. It is held to the one
  // thing it must do: define the escape somewhere in itself.
  if (name.endsWith(OWNER_RULE)) {
    if (!ESCAPE_IN_BODY.test(text)) {
      findings.push({
        skill: name,
        kind: 'the-escape-has-no-owner',
        detail: 'the rule that every other loop points at for the escape no longer defines one.',
      });
    }
    return findings;
  }
  // Judged PER PARAGRAPH, not per document. The first version asked whether the FILE anywhere stated
  // the escape or linked the rule that owns it — and every rule links that rule for other reasons, so
  // restoring the exact wording this check exists to catch left it green. An exemption read from
  // somewhere else in the document is an exemption granted by coincidence.
  for (const paragraph of passages(text)) {
    if (!LOOP_LANGUAGE.test(paragraph)) continue;
    if (ESCAPE_IN_BODY.test(paragraph)) continue;
    // A paragraph may DELEGATE: pointing at the rule that owns the escape answers the same question.
    if (paragraph.includes(OWNER_RULE)) continue;
    findings.push({
      skill: name,
      kind: 'rule-states-a-loop-without-its-escape',
      detail:
        'a mandatory rule describes a re-driven loop and never says what a round that changes nothing ' +
        'does — "' +
        paragraph.replace(/\s+/g, ' ').trim().slice(0, 90) +
        '". A rule outranks a skill, so a loop stated here without its escape licenses every loop ' +
        'that reads it. State the escape, or link the rule that owns it.',
    });
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

  const rulesDir = path.join(root, RULES_DIR);
  if (!existsSync(rulesDir))
    throw new Error(`loop-contract: ${RULES_DIR} does not exist under ${root}.`);
  const ruleNames = readdirSync(rulesDir)
    .filter((n) => n.endsWith('.md'))
    .sort();
  if (ruleNames.length === 0)
    throw new Error(`loop-contract: ${RULES_DIR} holds no rules to examine.`);

  const findings = [];
  let loops = 0;
  for (const name of ruleNames) {
    const text = readFileSync(path.join(rulesDir, name), 'utf8');
    if (LOOP_LANGUAGE.test(text)) loops += 1;
    findings.push(...judgeRule({ name: `${RULES_DIR}/${name}`, text }));
  }
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
    const where = finding.skill.includes('/')
      ? finding.skill
      : `${SKILLS_DIR}/${finding.skill}/SKILL.md`;
    console.error(`- [${finding.kind}] ${where}: ${finding.detail}`);
  }
  if (findings.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} skills, plus every rule document`);
  console.log(
    `loop-contract scan passed (${examined} skill(s) and every rule document examined; ${loops} ` +
      'state a loop, each implementing the escape it declares and agreeing with the orchestration map).',
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
