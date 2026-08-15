/**
 * SSOT for "what counts as a standard SPEC.md section" (RULE-013, WU-A).
 *
 * THE LIST IS NOT COPIED HERE. `.agents/skills/spec-writing-standard/SKILL.md` owns it — the
 * document-standards taxonomy (meta-form #3) assigns "Required Sections" to the document-type
 * contract, and AGENTS.md gives each fact exactly one owner. So this module PARSES the skill's two
 * reference tables instead of restating them, mirroring `scan-doc-folder-status-agreement.mjs`,
 * which parses `spec-workflow.md`'s status↔folder table for the same reason.
 *
 * That reason is not theoretical. Before RULE-013 the list existed twice — nine rows in the skill,
 * eight in a hard-coded array in `cleanup-drift.mjs` that was missing `Class Contract Registry`.
 * A second copy is exactly the drift this repo's document-authority rules exist to prevent.
 *
 * FAIL-CLOSED. An unreadable or empty table throws rather than yielding an empty list — a caller
 * that silently measured against nothing would report a clean tree ("Silence is not success",
 * enforcement-architecture.md).
 *
 * REQUIRED AND OPTIONAL STAY DISTINGUISHABLE. `cleanup-drift` asserts the presence of the REQUIRED
 * nine; the whitebox-leakage metric spans REQUIRED ∪ OPTIONAL. Collapsing them into one list would
 * make a package's `## Configuration` suppress the report that it is missing
 * `## Class Contract Registry`.
 *
 * HEADING MATCHING IS PART OF THE CONTRACT, NOT AN IMPLEMENTATION DETAIL. Exact string matching
 * scored `apps/www` and `packages/agent-transport` as 100% non-standard when both carry all nine
 * required sections, correctly named, under ordinal prefixes (`## 1. Scope`). A check that fires on
 * the wrong subject is not a weaker check, it is a different one — so normalization lives here,
 * beside the list it matches against, and every consumer shares it.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SKILL_RELATIVE_PATH = path.join('.agents', 'skills', 'spec-writing-standard', 'SKILL.md');

/** Heading text of the required-sections table, used to anchor the parse. */
const REQUIRED_TABLE_ANCHOR = '## Required Sections Reference';
/** First column header of the optional table, used to tell the two tables apart. */
const OPTIONAL_TABLE_HEADER = /^\|\s*#\s*\|\s*Optional section\s*\|/i;
const REQUIRED_TABLE_HEADER = /^\|\s*#\s*\|\s*Section\s*\|/i;

const SEPARATOR_ROW = /^\|[\s:|-]+\|$/;
/** A data row's first cell is its ordinal — `1`…`9` for required, `O1`…`O6` for optional. */
const ORDINAL_CELL = /^O?\d+$/i;

/**
 * Normalize a markdown heading to its comparable section name.
 *
 * Absorbs the variations observed across the corpus, in order:
 * - leading `#` markers and surrounding whitespace
 * - an ordinal prefix (`1. `, `2) `) — `apps/www` and `agent-transport` number all nine sections
 * - emphasis markers and back-ticks
 * - a trailing parenthetical or bracketed qualifier (`Public API Surface (v3)`)
 * - case and internal whitespace runs
 */
export function normalizeSpecHeading(heading) {
  if (typeof heading !== 'string') return '';
  return heading
    .replace(/^#+\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/[*_`]/g, '')
    .replace(/\s*[([][^)\]]*[)\]]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseTableRows(lines, startIndex, headerPattern) {
  const names = [];
  let seenHeader = false;
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith('## ') && seenHeader) break;
    if (!line.startsWith('|')) {
      if (seenHeader && names.length > 0) break;
      continue;
    }
    if (!seenHeader) {
      if (headerPattern.test(line)) seenHeader = true;
      continue;
    }
    if (SEPARATOR_ROW.test(line)) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    // The ordinal column is what makes a row a row. Without this check the required parse runs on
    // into the optional table when no blank line separates them — `Optional section` would enter the
    // REQUIRED set and `## Configuration` would answer true to `isRequiredSpecSection`, which is the
    // exact collapse this module's header says must not happen.
    if (!ORDINAL_CELL.test(cells[0])) {
      if (names.length > 0) break;
      continue;
    }
    const name = normalizeSpecHeading(cells[1]);
    if (name) names.push(name);
  }
  return names;
}

/**
 * Rows the table declares, counted INDEPENDENTLY of the row-collecting loop.
 *
 * It deliberately does not share `parseTableRows`'s termination rule: two counts computed by the
 * same buggy loop always agree, so the comparison would prove nothing. This one scans to the next
 * `## ` heading and counts every row whose ordinal matches `ordinalPattern`, so a stray line inside
 * the table changes one count and not the other.
 */
function countDeclaredRows(lines, startIndex, ordinalPattern) {
  let count = 0;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|') || SEPARATOR_ROW.test(line)) continue;
    const first = line.split('|').slice(1, -1)[0]?.trim() ?? '';
    if (ordinalPattern.test(first)) count += 1;
  }
  return count;
}

/**
 * Read the standard SPEC section names from their owning document.
 *
 * @returns {{ required: string[], optional: string[], all: Set<string>, source: string }}
 *   Names are normalized. `required` and `optional` are deliberately separate.
 * @throws when the owner document or either table is missing or empty (fail-closed).
 */
export function readSpecSectionContract(workspaceRoot) {
  const skillPath = path.join(workspaceRoot, SKILL_RELATIVE_PATH);
  if (!existsSync(skillPath)) {
    throw new Error(
      `spec-sections: cannot read the section contract — ${SKILL_RELATIVE_PATH} is missing. ` +
        'Refusing to report against an unknown section list.',
    );
  }

  const lines = readFileSync(skillPath, 'utf8').split(/\r?\n/);
  const anchorIndex = lines.findIndex((line) => line.trim() === REQUIRED_TABLE_ANCHOR);
  if (anchorIndex === -1) {
    throw new Error(
      `spec-sections: "${REQUIRED_TABLE_ANCHOR}" not found in ${SKILL_RELATIVE_PATH}. ` +
        'The section contract moved or was renamed; this parser must be updated with it.',
    );
  }

  const required = parseTableRows(lines, anchorIndex, REQUIRED_TABLE_HEADER);
  const optional = parseTableRows(lines, anchorIndex, OPTIONAL_TABLE_HEADER);

  if (required.length === 0) {
    throw new Error(
      `spec-sections: the required-sections table in ${SKILL_RELATIVE_PATH} parsed as empty. ` +
        'Refusing to report a clean tree against an empty contract.',
    );
  }
  // A PARTIAL parse is the dangerous case, not an empty one: a single unexpected line inside the
  // table ends the loop, and a short list makes every consumer quietly stop checking the sections it
  // dropped. The table declares its own length in the ordinal column, so compare against that.
  const declaredRequired = countDeclaredRows(lines, anchorIndex, /^\d+$/);
  if (required.length !== declaredRequired) {
    throw new Error(
      `spec-sections: parsed ${required.length} required section(s) but the table in ` +
        `${SKILL_RELATIVE_PATH} declares ${declaredRequired}. A partial parse silently shrinks the ` +
        'contract every consumer checks against.',
    );
  }
  const declaredOptional = countDeclaredRows(lines, anchorIndex, /^O\d+$/i);
  if (optional.length !== declaredOptional && declaredOptional > 0) {
    throw new Error(
      `spec-sections: parsed ${optional.length} optional section(s) but the table in ` +
        `${SKILL_RELATIVE_PATH} declares ${declaredOptional}. A partial parse silently shrinks the ` +
        'contract every consumer checks against.',
    );
  }
  if (optional.length === 0) {
    throw new Error(
      `spec-sections: the optional-sections table in ${SKILL_RELATIVE_PATH} parsed as empty. ` +
        'RULE-013 requires it to be enumerated there; prose in Mode A is not machine-readable.',
    );
  }

  return {
    required,
    optional,
    all: new Set([...required, ...optional]),
    source: SKILL_RELATIVE_PATH,
  };
}

/** True when a raw markdown heading names a standard section (required OR optional). */
export function isStandardSpecSection(heading, contract) {
  return contract.all.has(normalizeSpecHeading(heading));
}

/** True when a raw markdown heading names a REQUIRED section. */
export function isRequiredSpecSection(heading, contract) {
  return contract.required.includes(normalizeSpecHeading(heading));
}
