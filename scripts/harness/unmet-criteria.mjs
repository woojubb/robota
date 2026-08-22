/**
 * U5 (issue #1965): a `status: done` record must not leave its own completion criteria unticked.
 *
 * Found by probing, not by reading: four `blocked`/`in-progress` items were marked `done`, dated and
 * moved to `completed/` — exactly what completing them would do — and `unearned-done-claims` PASSED,
 * along with `backlog-placement` and `task-archival`. Nine of the unticked boxes were acceptance
 * criteria the items wrote for themselves.
 *
 * ## Why the existing rules cannot see it
 *
 * U1–U4 all judge content that is PRESENT: an empty evidence field, an uncited evidence heading, a
 * dangling section reference, a ticked box whose claim cites nothing. None of them is about a
 * criterion that is present and UNMET. A record with no prose and five unticked boxes is, to those
 * rules, clean — and that is the shape that costs the most, because `status: done` is what the next
 * reader trusts instead of opening the file.
 *
 * `task-archival` is the nearest thing and keys on FULLY-checked, so a partly-checked record falls
 * through the same gap from the other side.
 *
 * ## What is exempt, and why it is a denylist
 *
 * Measured over the tracked tree: 459 unticked boxes across 20 distinct section headings, in eight
 * languages of phrasing between them (`Acceptance Criteria`, `수용 기준`, `Done gate`, `검증 항목`,
 * `최종 전환 체크리스트`, `Test Plan`, `Plan`, `3단계 — 특수 기능`). Enumerating the criteria ones
 * is a losing game and it fails open — see `NON_CRITERIA_HEADINGS` for what killed the first cut.
 *
 * `Test Plan` is not a plan in these records: its boxes read `pnpm … typecheck 에러 없음`,
 * `pnpm … test 전부 통과`. Those are verifications, and an unticked one in a done record says the
 * verification did not run.
 *
 * ## The escape is a decision someone wrote down
 *
 * `allow-unmet-criterion: <reason>` on the box's own line — the same shape `named-artifact-resolves`
 * uses. A criterion that legitimately survives completion is a judgement, and a judgement that has
 * to be written next to the thing it excuses is one the next reader can weigh.
 */

import { outsideFences } from './scan-unearned-done-claims.mjs';

/**
 * Headings whose boxes are NOT completion claims.
 *
 * A DENYLIST, not an allowlist, and the direction is the decision. An allowlist of "criteria-looking"
 * headings fails OPEN: a record with its criteria under a heading nobody enumerated escapes the rule
 * silently, and the next person to invent a heading name would never learn that they had. A denylist
 * judges everything and names the exceptions, so a new heading is covered on the day it is written.
 *
 * The first cut here WAS an allowlist, and measuring it against the item's own example is what
 * killed it: `INFRA-097`'s five unticked boxes — including "Add adversarial tests proving a PR
 * cannot replace its own required gate" — sit under `## Plan`, so the rule this issue asked for did
 * not fire on the record the issue was filed about.
 *
 * What survives is genuinely not a claim about this item's completion:
 *
 *   Children       a list of OTHER items. Their state is theirs, and an initiative's own gate is
 *                  what says whether they are all done.
 *   File Format    documentation OF the checkbox syntax, in `README.md`-shaped records.
 *
 * A plan step left unticked in a done record IS a gap — the record says finished while its own plan
 * says otherwise. When a step was superseded rather than skipped, that is a judgement, and
 * `allow-unmet-criterion:` is where it gets written down.
 */
export const NON_CRITERIA_HEADINGS = [/^children$/i, /^file\s+format$/i];

/** Is this heading one whose unticked boxes are unmet completion claims? */
export function isCriteriaHeading(heading) {
  return !NON_CRITERIA_HEADINGS.some((pattern) => pattern.test(heading.trim()));
}

const UNTICKED_BOX = /^\s*[-*+]\s*\[ \]\s*(.*)$/;
const ALLOW_UNMET = /allow-unmet-criterion:\s*(\S.*)/i;
const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Every unmet criterion in a done record.
 *
 * Walks the lines with the INNERMOST heading in hand rather than iterating sections, because
 * sections nest: a box under `## Plan` is also inside the document's `# Title`, and reporting it
 * under both was the first cut's defect — it doubled every finding and doubled the frozen counts
 * with it. A box belongs to the heading directly above it, which is also the one a reader would
 * name if asked which checklist it is in.
 *
 * The finding names that section as well as the line, because "which criterion" is the question the
 * reader has next and a line number alone does not answer it in a file of several checklists.
 */
export function findU5(lines) {
  const outside = outsideFences(lines);
  const findings = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    if (!outside[i]) continue;
    const h = HEADING.exec(lines[i]);
    if (h !== null) {
      heading = h[2].trim();
      continue;
    }
    const box = UNTICKED_BOX.exec(lines[i]);
    if (box === null) continue;
    if (!isCriteriaHeading(heading)) continue;
    // The reason must be on the box's own line. A reason a paragraph away could be excusing a
    // different box, and the point of the escape is that it is unambiguous which one it covers.
    if (ALLOW_UNMET.test(lines[i])) continue;
    findings.push({
      rule: 'U5',
      line: i + 1,
      message:
        `unmet criterion under '${heading || '(no heading)'}' in a done record: ` +
        `"${box[1].slice(0, 60)}". Tick it, or name the reason it survives completion with ` +
        '`allow-unmet-criterion: <reason>` on this line.',
    });
  }
  return findings;
}
