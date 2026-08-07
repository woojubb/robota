#!/usr/bin/env node

/**
 * A rule added to this repository says how it is enforced — or says that it is not, and why.
 *
 * ## The class
 *
 * `lesson-to-harness` step 8 is explicit: prose alone never closes a lesson, and a rule reaches one
 * of exactly two terminal states — mechanized, or infeasible-now with a written obstacle and a filed
 * item. Nothing checked it, so the step was skippable, and it was skipped: a rule landed in this
 * repository as three paragraphs with no mechanism, no filed item, and no statement that it had
 * neither. It read exactly like a rule that was enforced.
 *
 * That is the same defect the mistake catalogue already fences one level down, where every entry
 * carries `**Mechanism:** <name>` or `none — <reason>` and the count of the second is printed on
 * every run. This applies the same contract to the rules themselves, at the moment a rule is ADDED —
 * which is the only moment the author still has the argument in their head.
 *
 * ## What it examines
 *
 * The DIFF, not the tree. Demanding a declaration from every rule already written would be a
 * migration, and a migration is a different decision from a floor. What is checked is what this
 * change adds: a new `###` rule section under `.agents/rules/`, which must carry one of
 *
 *   Enforced by: `<scan-or-check-name>`
 *   Enforced by: nothing — <why a machine cannot decide this>
 *
 * Either is an answer. Silence is not, and silence is what a reader cannot tell from enforcement.
 *
 * ## Why a section and not a whole file
 *
 * Rules arrive one section at a time into documents that already exist. A file-level check would
 * pass every real case — the file was already there — which is a check that cannot fail.
 *
 * Exit 0 = every rule section this change adds answers.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const RULES_PREFIX = '.agents/rules/';

/** The declaration, in either terminal state. */
// An em dash OR a plain hyphen. The two are semantically identical here, and refusing the hyphen
// made a required scan reject a correct declaration over a character nobody can see is wrong — the
// reader is told the rule is undeclared, which is not what happened.
const DECLARED = /Enforced by:\s*(?:`([^`]+)`|nothing\s*[—-]\s*([^\n]+))/;

/** A heading that introduces a normative section. `##` is a grouping; `###` is where rules live. */
const RULE_HEADING = /^\+###\s+(.+)$/;

/**
 * A rule ADDED under a heading that already existed.
 *
 * Review found this floor firing only on a brand-new `### heading`, which is not how most rules
 * arrive — a rule is usually another bullet under a section that is already there. A floor that
 * misses the common case is close to no floor, so the added BULLET is a subject too.
 *
 * Narrow on purpose, because every prose edit under a rules heading is an added line and refusing
 * those would make this fire on correct work. A rule states an obligation, so this asks for one: a
 * list item carrying a normative keyword. An added sentence that explains, illustrates or softens is
 * not matched, and neither is a bullet that merely mentions one of these words in passing prose
 * after the first clause.
 */
const ADDED_RULE_BULLET =
  /^\+\s*[-*]\s+(?:\*\*)?[^.\n]{0,120}?\b(MUST|MUST NOT|NEVER|ALWAYS|PROHIBITED|REQUIRED|is banned|is forbidden)\b/;

export function resolveBaseRef({ argv = process.argv.slice(2), env = process.env } = {}) {
  const flag = argv.indexOf('--base-ref');
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1];
  return env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : 'origin/develop';
}

/**
 * Sections a diff ADDS, with the added lines that follow each.
 *
 * Reads the unified diff rather than the file, because the question is what this change introduces.
 * A section that already existed is not this floor's business, however undeclared it is.
 */
export function addedRuleSections(diff) {
  const sections = [];
  let file = null;
  let current = null;

  for (const line of diff.split('\n')) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) {
      file = header[1];
      current = null;
      continue;
    }
    if (!file || !file.startsWith(RULES_PREFIX)) continue;

    // A new hunk closes the section a previous hunk opened. Without this the body kept accumulating
    // to the next heading anywhere in the file, so a declaration added FAR AWAY — under a different
    // rule, in a later hunk — would answer for this one. The heading and its declaration must arrive
    // together, which is the whole point of asking at the moment a rule is written.
    if (line.startsWith('@@')) {
      current = null;
      continue;
    }

    const heading = RULE_HEADING.exec(line);
    if (heading) {
      current = { file, title: heading[1].trim(), body: '' };
      sections.push(current);
      continue;
    }
    // A rule added under a heading that already existed. It opens its own section, because the
    // declaration has to arrive WITH it — a declaration already in the file, under some other rule,
    // is exactly what this floor exists to stop counting as an answer.
    if (!current && ADDED_RULE_BULLET.test(line)) {
      current = { file, title: line.slice(1).trim().slice(0, 80), body: `${line.slice(1)}\n` };
      sections.push(current);
      continue;
    }
    // Only ADDED lines count toward the body: a declaration that was already in the file, under a
    // different section, must not excuse the new one.
    if (current && line.startsWith('+')) current.body += `${line.slice(1)}\n`;
  }

  return sections;
}

export function judgeSections(sections) {
  return sections
    .filter((section) => !DECLARED.test(section.body))
    .map((section) => ({
      file: section.file,
      title: section.title,
      detail:
        'is a new rule and does not say how it is enforced. Add `Enforced by: `<check>`` or ' +
        '`Enforced by: nothing — <why a machine cannot decide this>`. Both are answers; ' +
        'silence is what a reader cannot tell from enforcement.',
    }));
}

export function readDiff(baseRef, { cwd = WORKSPACE_ROOT } = {}) {
  try {
    return execFileSync('git', ['diff', '--unified=0', `${baseRef}...HEAD`, '--', RULES_PREFIX], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function main() {
  const baseRef = resolveBaseRef();
  const diff = readDiff(baseRef);

  // Fail closed, and MEAN it. The first version wrote this comment and then returned without an
  // exit code — a SKIPPED line and a silent pass, which is precisely the state the comment claims to
  // refuse. Review caught it, and it is the same defect INFRA-048 fixed once already in the scan
  // this one is modelled on. "I could not read the diff" is not "the diff adds no rule".
  if (diff === null) {
    process.exitCode = 1;
    // NOT `::expected-empty::`. That marker declares a zero the runner should accept, and this zero
    // is one nobody established — the very distinction this scan's own subject is about.
    console.log('::examined:: 0 new rule sections');
    console.error(
      `new-rule-declares-enforcement scan FAILED — cannot read the diff against \`${baseRef}\`. ` +
        'Fetch the base ref (a shallow clone has no merge base), or pass --base-ref explicitly.',
    );
    return;
  }

  const sections = addedRuleSections(diff);
  console.log(
    sections.length === 0
      ? '::examined:: 0 new rule sections ::expected-empty:: this change adds no rule'
      : `::examined:: ${sections.length} new rule sections`,
  );

  const findings = judgeSections(sections);
  if (findings.length > 0) {
    console.error(`new-rule-declares-enforcement scan failed: ${findings.length} new rule(s):`);
    for (const finding of findings) {
      console.error(`  - ${finding.file} § ${finding.title}: ${finding.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `new-rule-declares-enforcement scan passed (${sections.length} new rule section(s); each says how it is enforced).`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
