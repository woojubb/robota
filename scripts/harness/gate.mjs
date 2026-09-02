#!/usr/bin/env node

/**
 * The mechanical half of every spec-document gate, as a script (PROC-016, TC-04).
 *
 * WHY THIS EXISTS, measured. One regex-token fix (issue #2378 → HARNESS-127 → PR #2396) took 72
 * minutes of wall clock, of which four were implementation and ~50 were gates, reviews and ledgers:
 * seven `backlog-gate-guard` dispatches judged criteria such as "every Completion Criteria item has a
 * `TC-N` prefix" and "the Test Plan row count matches" — checks a script answers in milliseconds — and
 * found no defect. `gate-catalogue.md` now tags every criterion `mechanical` or `semantic`; this
 * script judges the mechanical set and reports the semantic set as `PENDING-GUARDIAN`, so the agent is
 * dispatched only for the half that needs judgement, or when the mechanical half is not PASS.
 *
 * THE CRITERIA ARE NOT COPIED HERE. The catalogue owns which criteria exist and which are mechanical;
 * this script READS the catalogue at run time, binds each mechanical criterion to a judgement by the
 * wording of the criterion, and never invents a criterion the catalogue does not state. The binding is
 * fail-closed in the only direction that matters: a criterion the catalogue tags `mechanical` but this
 * script has no judgement for is reported `PENDING-GUARDIAN`, never PASS, and an untagged criterion is
 * treated as `semantic`. The same rule for the status ↔ folder mapping (`spec-workflow.md`, read via
 * `parseStatusFolderMapping`) and for the approval evidence form and class registry
 * (`backlog-execution.md`, read via the `scan-standing-delegation-evidence` parsers).
 *
 * VERDICT PRECEDENCE. FAIL > PENDING-GUARDIAN > PASS. A mechanical FAIL is written and exits 1 even
 * when semantic criteria are still pending: the guardian cannot turn a missing `TC-N` prefix into a
 * pass, so dispatching it before the document is fixed only spends the dispatch. When nothing fails
 * and at least one criterion is pending, NO entry is written and the exit is 2 — the guardian judges
 * the pending set and writes the entry. Only an all-mechanical PASS writes the ✅ entry and exits 0.
 *
 * THE LANE DECIDES WHICH SET APPLIES. `spec-workflow.md` § Lanes and `gate-catalogue.md` § Gates per
 * lane define L1 as the gates' MECHANICAL criteria, judged by this script alone, with the guardian
 * dispatched only on a non-PASS. So under lane L1 a criterion the catalogue tags `semantic` is not
 * pending — it is recorded in the entry as `N/A — not required for lane L1 (spec-workflow.md §
 * Lanes)`, a PASS-class line, and a conforming L1 draft exits 0. Under L2 the semantic set is the
 * guardian's and stays PENDING-GUARDIAN (exit 2). The fail-closed cases are unchanged by the lane:
 * an UNTAGGED criterion, and a `mechanical` one this script has no judgement for, are pending in
 * every lane, because neither has been shown to be dispensable.
 *
 * THE DOCUMENT'S `lane:` IS AUTHORITATIVE. `--lane` may equal the frontmatter lane, or set the lane
 * when the frontmatter declares none; a `--lane` that differs from a declared lane is refused (exit 1)
 * before anything is judged — a flag that could lower an L2 document to L1 would excuse its semantic
 * set with seven N/A lines. A document with no `lane:` and no `--lane` is L2.
 *
 * PLAN's THIRD SET. Beside GATE-WRITE's mechanical criteria and GATE-APPROVAL, `[GATE-PLAN]` composes
 * the three GATE-IMPLEMENT criteria that are mechanical and Task-shaped — "`.agents/tasks/<ID>.md`
 * has been created", "Tasks file path is recorded in the `## Tasks` section", and "The exact Task
 * records a subject-bound user-execution PLAN terminal outcome" — never the worktree inventory, which
 * PLAN does not produce. Their evidence lines carry the paired Task path as an exact bounded token and
 * the Task's own `SCENARIO DRAFTED: <outcome> | <n>` verbatim, which is what
 * `scan-user-execution-plan-order` reads an L1 checkpoint by. The Task path criterion also requires
 * the Task's basename to equal the spec's, and the PLAN-outcome criterion requires exactly one
 * `**Author verdict:** \`SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>\`` line under the
 * Task's `## User Execution Test Scenarios` — the form that scan binds the checkpoint to. The three
 * are selected by the judgement their wording binds; a catalogue that no longer binds one of them is
 * a refusal, not a PLAN with two.
 *
 * PROBLEM PROSE FLOOR. HTML comments (`<!-- … -->`, multi-line) are stripped before `## Problem` is
 * measured, so the scaffold's guidance comment is not prose. The floor is ≥ 2 sentences OR ≥ 200
 * characters of what remains. Measured on 2026-08-28 over the 280 `done/` specs: the shortest genuine
 * Problem is 83 chars / 2 sentences (DOCAUDIT-004), the next 85 / 2 and 146 / 2 — every one passes on
 * sentences; the unedited scaffold seed ("<title>." + the comment) is 1 sentence and fails.
 *
 * STATUS ON A RE-RUN. GATE-WRITE's "`status: draft` present" also accepts the status a prior
 * `[GATE-WRITE] — ✅ PASS` upgraded the document to (`review-ready`), so a second GATE-WRITE on a
 * document that already passed once — this branch's own case — is not failed for having advanced.
 * Without that prior PASS the criterion fails as written.
 *
 * REVIEW UNCHANGED SINCE APPROVAL, by fingerprint. `approve` records what it approved: the field line
 * `**Review fingerprint:** <12 hex> (review <8 hex>, type/tags <8 hex>)` — sha256 over the
 * `## Architecture Review` body and over the top-level `type:`/`tags:` frontmatter lines, each
 * whitespace-normalised, the combined hash first. "No Architecture Review or frontmatter type/tags
 * modified after approval" PASSes when the document's current fingerprint equals the recorded one,
 * FAILs naming the part that differs (the review section, the type/tags lines, or both), and is
 * `PENDING-GUARDIAN` only when the standing entry carries no fingerprint line — an entry the guardian
 * agent wrote by hand rather than `approve`. No git is read, so an untracked draft is judged the same
 * as a committed one, and no calendar date is compared (a same-day edit still differs). The field
 * name `Review fingerprint` is stable: the criterion reads it back by that name.
 *
 * APPROVE EARNS ITS VERDICT. `approve` writes the route/instruction fields and, in the same write,
 * judges the GATE-APPROVAL mechanical set against the entry: the heading is `✅ PASS` only when every
 * mechanical criterion passes, with their result lines in the entry; otherwise the entry is `❌ FAIL`
 * with the failed (or undecidable) criteria and the exit is 1. `advance` refuses the last PASS entry
 * unless it carries at least one per-criterion result line (`- <GATE> — <criterion>: <observed>`) —
 * a bare heading and a Status-upgrade line is not a judged gate.
 *
 * VERIFY COMMAND SHAPE. GATE-VERIFY's "Build passes" needs at least one `--verify-cmd` containing
 * `build`, `harness:scan` or `run-all-scans` (the last two are the build-equivalent for a scope with
 * no package build — `scripts/**`-only changes); "Tests pass" needs one containing `test` or
 * `vitest`. Every supplied command is recorded verbatim with its exit; all must exit 0. `true` exits
 * 0 and satisfies neither.
 *
 * A catalogue with no `## Prior-gate map` is a refusal, not an empty map: the ordering checks are
 * part of every gate, and a table that cannot be read judges nothing.
 *
 * Subcommands (every path option accepts a workspace-relative or absolute path):
 *
 *   judge   --gate GATE-WRITE|GATE-APPROVAL|GATE-IMPLEMENT|GATE-VERIFY|GATE-COMPLETE --doc <spec>
 *           [--lane L1|L2] [--catalogue <path>] [--rule <spec-workflow.md>]
 *           [--backlog-rule <backlog-execution.md>] [--root <workspace>] [--date YYYY-MM-DD]
 *           [--verify-cmd "<cmd>"]... [--dry-run]
 *           With `--lane L1` the gate names `PLAN` (or `GATE-PLAN`) and `DONE` (or `GATE-DONE`) are
 *           accepted: PLAN judges the GATE-WRITE + GATE-APPROVAL mechanical sets and writes a
 *           `[GATE-PLAN]` entry (`draft → approved`); DONE judges GATE-VERIFY + GATE-COMPLETE and
 *           writes `[GATE-DONE]` (`approved → done`). A plain gate name under `--lane L1` judges that
 *           gate's mechanical set the same way, semantic criteria recorded N/A. The lane is the
 *           document's `lane:` frontmatter; `--lane` may only equal it, or set it when there is none
 *           (see THE DOCUMENT'S `lane:` IS AUTHORITATIVE above); absent both, L2.
 *           ORDER: `approve` runs BEFORE any gate that composes GATE-APPROVAL (PLAN under L1,
 *           GATE-APPROVAL under L2). Those criteria read the standing `[GATE-APPROVAL]` entry
 *           `approve` writes; while none exists they are reported `PENDING — run approve first`, no
 *           entry is written, and the exit is 2 — a step not yet run is not a defect in the document.
 *   record  --doc <spec> --tc TC-NN (--command "<cmd>" --exit <n> --output-file <path> | --skip "<reason>")
 *           [--date YYYY-MM-DD]
 *           Appends the per-criterion `### [GATE-COMPLETE: TC-NN]` entry GATE-COMPLETE requires.
 *   advance --doc <spec> [--rule <spec-workflow.md>] [--root <workspace>]
 *           Reads the last Evidence Log entry; refuses unless it is a PASS with a `**Status upgrade:**`
 *           line; moves the file to the folder the rule maps the next status to; rewrites `status:`
 *           and the paired Task's citation of the old path. The move is `git mv` for a tracked file
 *           and a plain rename, said so in the output, for a draft git does not track yet.
 *   approve --doc <spec> --route DIRECT|CLASS --instruction "<verbatim>" [--class <ID>]
 *           [--given YYYY-MM-DD] [--date YYYY-MM-DD] [--evidence "<note>"] [--backlog-rule <path>]
 *           [--catalogue <path>] [--root <workspace>]
 *           Appends the GATE-APPROVAL entry in the form `backlog-execution.md` § Delegated Approval
 *           Classes specifies, judged at once against the catalogue's GATE-APPROVAL mechanical set
 *           (APPROVE EARNS ITS VERDICT above): ✅ with the result lines, or ❌ and exit 1. Route
 *           CLASS reads the class's Evidence condition from its registry row;
 *           where this script binds a measurement to that wording the evidence is MEASURED, never
 *           typed. Bound today: "`scan-lane-declaration` exits 0 …" runs that scan over the branch's
 *           changed set — committed AND working-tree changes against the base — with the spec's
 *           `lane:`, and records its summary line. A changed set of ZERO paths is refused: a pass over
 *           nothing is not evidence that the condition is met. `--evidence "<text>"` appends a note to a
 *           measured condition; it is the whole evidence only for a class this script cannot measure.
 *
 * L1 ORDER, end to end: `new-spec.mjs` → write → `approve --route CLASS --class LANE-L0-L1` → `judge
 * --gate PLAN --lane L1` → `advance` → ONE planning commit → implement → `record` per TC → `judge
 * --gate DONE` → `advance`.
 *
 * DATES. Every date this script stamps — `judge`, `record`, `approve` — is the LOCAL calendar date,
 * the one the registry rows and the guardian agents write; `--date YYYY-MM-DD` overrides it on each.
 * An approval at 01:50 KST on the 28th is dated the 28th, not UTC's 27th, and so is not refused
 * against a row registered on the 28th.
 *
 * BASE REF. The changed set `approve --route CLASS` measures is diffed against the merge base with
 * `HARNESS_BASE_REF` when set, else with `origin/develop` — the variable `run-all-scans --affected`
 * and `scan-lane-declaration` honour. On a branch stacked on another feature branch set
 * `HARNESS_BASE_REF=<that branch>`, or the measured diff carries the parent branch's changes too.
 *
 * Exit codes: judge 0 PASS / 1 FAIL / 2 PENDING (guardian, or approve not yet run); every other
 * subcommand 0 done / 1 refused.
 * A missing catalogue, rule, document or section is a refusal (exit 1) with the reason printed — a
 * gate that cannot read its own criteria has judged nothing ("Silence is not success").
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { asList, asScalar, frontmatterObject, splitFrontmatter } from './frontmatter.mjs';
import {
  checkpointCheckboxItems,
  checkpointCompletionCriteria,
} from './checkpoint-evidence-contract.mjs';
import {
  correctionCheckpointEvidence as renderCorrectionCheckpointEvidence,
  continuationCheckpointEvidence as renderContinuationCheckpointEvidence,
  firstCheckpointEvidence as renderFirstCheckpointEvidence,
} from './gate-checkpoint-evidence.mjs';
import {
  prepareTaskActivation,
  readTaskRecordText,
  resolveContinuationGate,
  rewriteFrontmatterStatus,
  validateNotApplicablePlan,
} from './gate-implementation-contract.mjs';
import { parseStatusFolderMapping } from './scan-doc-folder-status-agreement.mjs';
import { collectSpecResearchFindings } from './scan-spec-research.mjs';
import {
  classifyApproval,
  parseEvidenceForm,
  parseRegistry,
  parseRegistrySection,
  standingVerdict,
} from './scan-standing-delegation-evidence.mjs';
import { vacantAdvanceDestination } from './gate-advance-contract.mjs';
import { extractExamined } from './run-all-scans.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_CATALOGUE = '.agents/specs/gate-catalogue.md';
const DEFAULT_RULE = '.agents/rules/spec-workflow.md';
const DEFAULT_BACKLOG_RULE = '.agents/rules/backlog-execution.md';
/** The ledger the GATE-IMPLEMENT worktree criterion allows beside the paired spec/Task. */
const PLAN_LEDGER_DIR = '.agents/loop-runs/';

export const EXIT_PASS = 0;
export const EXIT_FAIL = 1;
export const EXIT_PENDING = 2;

/** What the entry records for a semantic criterion under lane L1 — a PASS-class line, not pending. */
export const L1_NOT_REQUIRED = 'N/A — not required for lane L1 (spec-workflow.md § Lanes)';

/** What a GATE-APPROVAL criterion reports while no standing approval entry exists yet. */
export const APPROVE_FIRST =
  'PENDING — run `gate.mjs approve` first (no standing [GATE-APPROVAL] entry)';

/** The `## Problem` floor after HTML comments are stripped — see PROBLEM PROSE FLOOR in the header. */
export const PROBLEM_MIN_SENTENCES = 2;
export const PROBLEM_MIN_CHARS = 200;

/** The `--verify-cmd` shapes GATE-VERIFY's two command criteria each need at least one of. */
export const BUILD_COMMAND_SHAPE = /build|harness:scan|run-all-scans/i;
export const TEST_COMMAND_SHAPE = /\btest|vitest/i;

/** The GATE-IMPLEMENT judgements PLAN composes — Task-shaped and mechanical, never the inventory. */
export const PLAN_IMPLEMENT_JUDGEMENTS = ['task-created', 'task-path-recorded', 'plan-outcome'];

/** The GATE-APPROVAL field `approve` records the approved review under — stable, read back by name. */
export const REVIEW_FINGERPRINT_LABEL = 'Review fingerprint';

/** The Task line the PLAN-outcome criterion (and `scan-user-execution-plan-order`) binds to. */
const AUTHOR_VERDICT_LINE =
  /^\*\*Author verdict:\*\*\s+`SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)`\s*$/gm;

const SPEC_GATES = [
  'GATE-WRITE',
  'GATE-APPROVAL',
  'GATE-IMPLEMENT',
  'GATE-VERIFY',
  'GATE-COMPLETE',
];

/**
 * The L1 lane's two gates, each composed from the catalogue's own criterion sets. The status
 * upgrades are the lane's (PROC-016 § Decision): an L1 document goes `draft → approved → done` and
 * never enters `active/`.
 */
const LANE_L1 = {
  'GATE-PLAN': {
    aliases: ['PLAN', 'GATE-PLAN'],
    composes: ['GATE-WRITE', 'GATE-APPROVAL', 'GATE-IMPLEMENT'],
    // Of GATE-IMPLEMENT only the three Task-shaped judgements (PLAN's THIRD SET in the header).
    select: { 'GATE-IMPLEMENT': PLAN_IMPLEMENT_JUDGEMENTS },
    upgrade: ['draft', 'approved'],
    prior: null,
  },
  'GATE-DONE': {
    aliases: ['DONE', 'GATE-DONE'],
    composes: ['GATE-VERIFY', 'GATE-COMPLETE'],
    select: {},
    upgrade: ['approved', 'done'],
    prior: { gate: 'GATE-PLAN', status: 'approved' },
  },
};

// ── Argument parsing ─────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  const options = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const flagOnly = key === 'dry-run' || key === 'continuation' || key === 'correction';
    if (flagOnly) {
      options[key] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    i += 1;
    if (key === 'verify-cmd') {
      options['verify-cmd'] = [...(options['verify-cmd'] ?? []), value];
    } else {
      options[key] = value;
    }
  }
  return { subcommand, options };
}

function resolveFrom(root, given, fallback) {
  const candidate = given ?? fallback;
  return path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
}

/**
 * The LOCAL calendar date as `YYYY-MM-DD` — never `toISOString()`, which is UTC. The registry rows
 * and the guardian agents date in local time, so a UTC stamp near midnight is a day behind them.
 */
export function localDate(date = new Date(), timeZone = undefined) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function today(options) {
  if (options.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('--date must be YYYY-MM-DD');
    return options.date;
  }
  return localDate();
}

function requireFile(file, what) {
  if (!existsSync(file)) throw new Error(`${what} not found: ${file}`);
  return readFileSync(file, 'utf8');
}

// ── Markdown helpers ─────────────────────────────────────────────────────────────────────────────

/**
 * The body of a level-2 section: from its heading to the next `## ` heading (fences respected, so a
 * `## ` inside a code block does not end the section).
 */
export function sectionBody(text, headingPattern) {
  const lines = String(text).split('\n');
  let fenced = false;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (start === -1) {
      if (/^##\s+/.test(line) && headingPattern.test(line.replace(/^##\s+/, '').trim())) start = i;
      continue;
    }
    if (/^##\s+/.test(line)) return { heading: lines[start], body: lines.slice(start + 1, i) };
  }
  return start === -1 ? null : { heading: lines[start], body: lines.slice(start + 1) };
}

/** Where a level-2 section ends (index of the next `## ` line, or the line count). */
function sectionEnd(lines, startIndex) {
  let fenced = false;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) fenced = !fenced;
    if (!fenced && /^##\s+/.test(lines[i])) return i;
  }
  return lines.length;
}

/** Every `- [ ]` / `- [x]` item (any indent) in a run of lines, with its continuation joined. */
export function checkboxItems(lines) {
  return checkpointCheckboxItems(lines);
}

/** Pipe-table data rows (header and separator dropped) as arrays of trimmed cells. */
export function tableRows(lines) {
  const rows = lines
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
  return rows.filter((cells, index) => index > 0 && !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

/** Every `### [<gate>…]` entry in the Evidence Log, in order, each with its heading and body lines. */
export function evidenceEntries(text) {
  const section = sectionBody(text, /^Evidence Log$/i);
  if (!section) return null;
  const entries = [];
  let current = null;
  for (const line of section.body) {
    const heading =
      /^###\s+\[([^\]]+)\]\s*—\s*(✅ PASS|❌ FAIL|🔴 NON-COMPLIANCE)\s*\|\s*(\d{4}-\d{2}-\d{2})/.exec(
        line,
      );
    if (heading) {
      current = {
        gate: heading[1],
        verdict: heading[2],
        date: heading[3],
        heading: line,
        lines: [],
      };
      entries.push(current);
      continue;
    }
    if (/^###\s/.test(line)) {
      current = { gate: null, verdict: null, date: null, heading: line, lines: [] };
      entries.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return entries;
}

function statusUpgradeOf(entry) {
  for (const line of entry.lines) {
    const match = /^\*\*Status upgrade:\*\*\s*`?([a-z-]+)`?\s*→\s*`?([a-z-]+)`?/.exec(line);
    if (match) return { from: match[1], to: match[2] };
  }
  return null;
}

/** Append lines to the end of `## Evidence Log` (before the next `## ` heading, if any). */
export function appendToEvidenceLog(text, entryLines) {
  const lines = String(text).split('\n');
  const start = lines.findIndex((line) => /^##\s+Evidence Log\s*$/i.test(line));
  if (start === -1) throw new Error('the document has no `## Evidence Log` section to write into');
  const end = sectionEnd(lines, start);
  // Trim trailing blank lines of the section so exactly one blank line separates entries.
  let cut = end;
  while (cut > start + 1 && lines[cut - 1].trim() === '') cut -= 1;
  const after = lines
    .slice(end)
    .filter((line, index, all) => !(index === all.length - 1 && line === ''));
  const out = [...lines.slice(0, cut), '', ...entryLines, ''];
  if (after.length > 0) out.push(...after, '');
  return out.join('\n');
}

// ── Catalogue reading ────────────────────────────────────────────────────────────────────────────

/**
 * The gate sections of the catalogue: `### GATE-NAME \`from → to\`` headings, each with its checkbox
 * criteria. A criterion is one `- [ ]` item plus its indented continuation (soft-wrapped text and
 * sub-bullets); its tag is the trailing `` — `mechanical` `` / `` — `semantic` ``. Untagged reads as
 * `semantic` — the fail-closed default, since a criterion nobody classified has not been shown to be
 * judgeable by a script.
 */
export function parseCatalogue(text) {
  const lines = String(text).split('\n');
  const gates = new Map();
  let current = null;
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^###\s+(GATE-[A-Z]+|DONE-GATE-STAGE-\d)\b(.*)$/.exec(line);
    if (heading) {
      const upgrade = /`([a-z-]+)\s*→\s*([a-z-]+)`/.exec(heading[2]);
      current = {
        gate: heading[1],
        upgrade: upgrade ? { from: upgrade[1], to: upgrade[2] } : null,
        criteria: [],
        lines: [],
      };
      gates.set(heading[1], current);
      continue;
    }
    if (/^##\s+/.test(line) || /^###\s+/.test(line)) {
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  for (const gate of gates.values()) {
    for (const item of checkboxItems(gate.lines)) {
      // The tag closes the criterion's first line; when sub-bullets follow it sits mid-text.
      const tags = [...item.text.matchAll(/\s*—\s*`(mechanical|semantic)`(?=\s|$)/g)];
      const last = tags[tags.length - 1];
      gate.criteria.push({
        text: last ? item.text.replace(last[0], '').replace(/\s+/g, ' ').trim() : item.text,
        tag: last ? last[1] : null,
        indent: item.indent,
      });
    }
  }
  return { gates, priorGates: parsePriorGateMap(text) };
}

/**
 * The catalogue's prior-gate map: `| GATE-X | GATE-Y | \`status\` |` rows under "Prior-gate map". A
 * catalogue without the section is a refusal — an empty map would silently drop every ordering check.
 */
export function parsePriorGateMap(text) {
  const section = sectionBody(text, /^Prior-gate map$/i);
  const map = new Map();
  if (!section)
    throw new Error(
      'the catalogue states no `## Prior-gate map` section — the ordering checks cannot run without it',
    );
  for (const cells of tableRows(section.body)) {
    const [gate, prior, status] = cells;
    const statusToken = /`([a-z-]+)`/.exec(status ?? '');
    if (
      /^GATE-[A-Z]+(?: \((?:continuation|correction)\))?$/.test(gate ?? '') &&
      /^GATE-[A-Z]+$/.test(prior ?? '')
    ) {
      map.set(gate, { gate: prior, status: statusToken ? statusToken[1] : null });
    }
  }
  return map;
}

// ── Document reading ─────────────────────────────────────────────────────────────────────────────

function loadDocument(docPath, text = requireFile(docPath, 'spec document')) {
  const { entries, body } = splitFrontmatter(text);
  const fm = entries ? Object.fromEntries(entries) : {};
  return { path: docPath, text, fm, body, hasFrontmatter: entries !== null };
}

/** The Task path the spec's `## Tasks` section names, or null. */
export function taskPathFromSpec(text) {
  const section = sectionBody(text, /^Tasks$/i);
  if (!section) return null;
  const match = /\.agents\/tasks\/[^\s`)>\]]+\.md/.exec(section.body.join('\n'));
  return match ? match[0] : null;
}

function completionCriteria(text) {
  return checkpointCompletionCriteria(text);
}

function tcIdOf(itemText) {
  const match = /^(TC-\d{2,}):/.exec(itemText);
  return match ? match[1] : null;
}

function testPlanRows(text) {
  const section = sectionBody(text, /^Test Plan$/i);
  if (!section) return null;
  return tableRows(section.body).map((cells) => ({
    id: cells[0]?.replace(/`/g, '') ?? '',
    type: cells[1] ?? '',
    tool: cells[2] ?? '',
    notes: cells[3] ?? '',
    all: cells.join(' | '),
  }));
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ── Mechanical judgements ────────────────────────────────────────────────────────────────────────

/**
 * Each judgement binds to a criterion by the WORDING the catalogue uses for it. The order matters
 * only where two patterns could match the same criterion (the first wins). A judgement returns
 * `{ ok, observed }`; `observed` is the evidence line the Evidence Log entry records.
 */
const pass = (observed) => ({ ok: true, observed });
const fail = (observed, action) => ({ ok: false, observed, action });
/** A mechanical criterion this script cannot decide on this document — the guardian's, never a pass. */
const pending = (observed) => ({ ok: false, pending: true, observed });

function frontmatterChecks() {
  return [
    {
      id: 'frontmatter-block',
      pattern: /begins with `---`/i,
      run: ({ doc }) =>
        doc.hasFrontmatter
          ? pass('file begins with a `---` frontmatter block')
          : fail('no `---` frontmatter block at the top of the file', 'add the frontmatter block'),
    },
    {
      id: 'frontmatter-status',
      pattern: /`status:\s*([a-z-]+)`\s+present/i,
      run: ({ doc, criterion, criterionGate }) => {
        const expected = /`status:\s*([a-z-]+)`/.exec(criterion.text)[1];
        const actual = doc.fm.status;
        if (actual === expected) return pass(`\`status: ${actual}\``);
        // A re-run (STATUS ON A RE-RUN in the header): the prior PASS of this same gate upgraded the
        // document to the status it now carries.
        const prior = (evidenceEntries(doc.text) ?? [])
          .filter((entry) => entry.gate === criterionGate && entry.verdict === '✅ PASS')
          .pop();
        const upgrade = prior ? statusUpgradeOf(prior) : null;
        if (upgrade && upgrade.to === actual)
          return pass(
            `re-run: \`status: ${actual}\` is the upgrade target of the prior [${criterionGate}] PASS (${prior.date})`,
          );
        return fail(
          `\`status: ${actual ?? '(absent)'}\`, required \`status: ${expected}\``,
          `set \`status: ${expected}\``,
        );
      },
    },
    {
      id: 'frontmatter-type',
      pattern: /`type:` is exactly one value/i,
      run: ({ doc, criterion }) => {
        const listText = criterion.text.split(':').slice(-1)[0] ?? '';
        const allowed = listText
          .split('·')
          .map((token) => token.trim())
          .filter((token) => /^[A-Z]+$/.test(token));
        if (allowed.length < 2) {
          return fail(
            'the criterion names no type list this script can read',
            'keep the `·`-separated type list in the criterion',
          );
        }
        const actual = doc.fm.type;
        return allowed.includes(actual)
          ? pass(`\`type: ${actual}\` is one of ${allowed.length} allowed values`)
          : fail(
              `\`type: ${actual ?? '(absent)'}\` is not one of ${allowed.join(' · ')}`,
              'set `type:` to one of the listed values',
            );
      },
    },
    {
      id: 'frontmatter-tags',
      pattern: /`tags:` field present/i,
      run: ({ doc }) =>
        Object.hasOwn(doc.fm, 'tags')
          ? pass(
              `\`tags:\` present (${Array.isArray(doc.fm.tags) ? doc.fm.tags.length : 1} value(s))`,
            )
          : fail(
              '`tags:` absent from the frontmatter',
              'add a `tags:` field (an empty `[]` is allowed)',
            ),
    },
  ];
}

/**
 * `text` with every HTML comment removed, the way a renderer would show it.
 *
 * One `replace(/<!--[\s\S]*?-->/g, '')` is not enough: removing the inner comment of
 * `<!-<!-- a -->- b -->` leaves `<!-- b -->`, a comment the single pass never saw. The scan is
 * repeated until the text stops changing, and an opener with no closer runs to the end of the text,
 * which is what markdown does with it — so what the floor measures is what a reader would see.
 */
export function stripHtmlComments(text) {
  let out = text;
  for (;;) {
    const next = stripHtmlCommentsOnce(out);
    if (next === out) return out;
    out = next;
  }
}

function stripHtmlCommentsOnce(text) {
  let out = '';
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    if (open === -1) return out + text.slice(from);
    out += text.slice(from, open);
    const close = text.indexOf('-->', open + '<!--'.length);
    if (close === -1) return out;
    from = close + '-->'.length;
  }
}

function problemChecks() {
  return [
    {
      id: 'problem-no-placeholders',
      pattern: /"TBD".*"TODO"/i,
      run: ({ doc }) => {
        const section = sectionBody(doc.text, /^Problem$/i);
        if (!section) return fail('no `## Problem` section', 'add the Problem section');
        // PROBLEM PROSE FLOOR (header): comments are guidance, not prose.
        const prose = stripHtmlComments(section.body.join('\n')).trim();
        const placeholder = /\b(TBD|TODO)\b/.exec(prose);
        if (placeholder)
          return fail(
            `\`## Problem\` contains "${placeholder[1]}"`,
            'replace the placeholder with the concrete problem',
          );
        const sentences = prose.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
        if (prose.length < PROBLEM_MIN_CHARS && sentences.length < PROBLEM_MIN_SENTENCES) {
          return fail(
            `\`## Problem\` is ${prose.length} chars / ${sentences.length} sentence(s) after stripping HTML comments — below the floor of ≥ ${PROBLEM_MIN_SENTENCES} sentences or ≥ ${PROBLEM_MIN_CHARS} chars of real text`,
            'describe the symptom and its reproduction condition in the prose itself',
          );
        }
        return pass(
          `\`## Problem\` has no TBD/TODO; ${prose.length} chars, ${sentences.length} sentences`,
        );
      },
    },
  ];
}

/**
 * Prior-art substantiation is judged by the scan that owns research.md, not by a second regex here:
 * `collectSpecResearchFindings` walks a spec tree, so the document is staged alone in a scratch tree
 * and the scan's verdict on it is the verdict recorded.
 */
function priorArtVerdict(doc) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'robota-gate-research-'));
  try {
    const stage = path.join(scratch, '.agents/spec-docs/draft');
    mkdirSync(stage, { recursive: true });
    writeFileSync(path.join(stage, 'subject.md'), doc.text);
    const findings = collectSpecResearchFindings(scratch);
    return findings.map((finding) =>
      finding.replace(/^\.agents\/spec-docs\/draft\/subject\.md:\s*/, ''),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function priorArtChecks() {
  const substantiated = {
    run: ({ doc, cache }) => {
      cache.priorArt ??= priorArtVerdict(doc);
      return cache.priorArt.length === 0
        ? pass('`scan-spec-research` reports the section substantiated or explicitly waived')
        : fail(
            cache.priorArt.join('; '),
            'cite a documentation source, state that none was found, or add `Waived: <reason>`',
          );
    },
  };
  return [
    {
      id: 'prior-art-present',
      pattern: /`## Prior Art Research`.*section present/i,
      run: ({ doc }) =>
        sectionBody(doc.text, /^(Prior Art Research|Research)$/i)
          ? pass('`## Prior Art Research` section present')
          : fail('no `## Prior Art Research` (or `## Research`) section', 'add the section'),
    },
    { id: 'prior-art-substantiated', pattern: /section is substantiated/i, ...substantiated },
    { id: 'prior-art-waiver', pattern: /`Waived: <reason>` line/i, ...substantiated },
  ];
}

function architectureChecks() {
  const checklist = (doc) => {
    const section = sectionBody(doc.text, /^Architecture Review$/i);
    if (!section) return null;
    const lines = section.body;
    const start = lines.findIndex((line) => /^###\s+.*Checklist/i.test(line));
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1)
      if (/^###\s+/.test(lines[i])) {
        end = i;
        break;
      }
    return checkboxItems(lines.slice(start + 1, end));
  };
  return [
    {
      id: 'checklist-all-ticked',
      pattern: /All \d+ checklist items are `\[x\]`/i,
      run: ({ doc, criterion }) => {
        const items = checklist(doc);
        if (!items)
          return fail(
            'no `### Architecture Review Checklist` under `## Architecture Review`',
            'add the checklist',
          );
        const required = Number(/All (\d+)/i.exec(criterion.text)[1]);
        const unticked = items.filter((item) => !item.checked);
        if (items.length < required)
          return fail(
            `${items.length} checklist item(s), ${required} required`,
            'complete the checklist',
          );
        if (unticked.length > 0)
          return fail(
            `${unticked.length} unticked: ${unticked.map((item) => item.text.slice(0, 40)).join('; ')}`,
            'tick every checklist item once done',
          );
        return pass(`${items.length}/${items.length} checklist items \`[x]\``);
      },
    },
    {
      id: 'sibling-scan',
      pattern: /Sibling scan item is `\[x\]`/i,
      run: ({ doc }) => {
        const items = checklist(doc) ?? [];
        const item = items.find((entry) => /sibling scan/i.test(entry.text));
        if (!item)
          return fail('no checklist item mentioning "Sibling scan"', 'add the Sibling scan item');
        if (!item.checked)
          return fail('Sibling scan item is unticked', 'run the sibling scan and tick it');
        const evidence = item.text
          .replace(/sibling scan/i, '')
          .replace(/완료|complete[d]?/gi, '')
          .trim();
        return /N\/A:/.test(item.text) || evidence.length >= 20
          ? pass(
              `Sibling scan \`[x]\` with ${/N\/A:/.test(item.text) ? 'an explicit N/A reason' : 'completion evidence'}`,
            )
          : fail(
              'Sibling scan is ticked but carries neither evidence nor `N/A: <reason>`',
              'record what the scan found or an explicit N/A reason',
            );
      },
    },
    {
      id: 'alternatives',
      pattern: /Alternatives Considered has at least (\d+) entries/i,
      run: ({ doc, criterion }) => {
        const required = Number(/at least (\d+)/i.exec(criterion.text)[1]);
        const section = sectionBody(doc.text, /^Architecture Review$/i);
        const lines = section?.body ?? [];
        const start = lines.findIndex((line) => /^###\s+Alternatives Considered/i.test(line));
        if (start === -1)
          return fail(
            'no `### Alternatives Considered` under `## Architecture Review`',
            'add the alternatives',
          );
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i += 1)
          if (/^###\s+/.test(lines[i])) {
            end = i;
            break;
          }
        const block = lines.slice(start + 1, end);
        const entries = [];
        for (let i = 0; i < block.length; i += 1) {
          if (/^\d+\.\s+/.test(block[i])) entries.push([]);
          if (entries.length > 0) entries[entries.length - 1].push(block[i]);
        }
        const lacking = entries
          .map((entry, index) => ({ index: index + 1, text: entry.join('\n') }))
          .filter((entry) => !/\bPro\b/.test(entry.text) || !/\bCon\b/.test(entry.text));
        if (entries.length < required)
          return fail(
            `${entries.length} numbered alternative(s), ${required} required`,
            'add alternatives',
          );
        if (lacking.length > 0)
          return fail(
            `alternative(s) ${lacking.map((entry) => entry.index).join(', ')} lack a Pro or a Con`,
            'give every alternative a Pro and a Con',
          );
        return pass(`${entries.length} numbered alternatives, each with Pro and Con`);
      },
    },
    {
      id: 'decision-trade-off',
      pattern: /Decision references the trade-off/i,
      run: ({ doc }) => {
        const section = sectionBody(doc.text, /^Architecture Review$/i);
        const lines = section?.body ?? [];
        const start = lines.findIndex((line) => /^###\s+Decision/i.test(line));
        if (start === -1)
          return fail('no `### Decision` under `## Architecture Review`', 'add the decision');
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i += 1)
          if (/^###\s+/.test(lines[i])) {
            end = i;
            break;
          }
        const text = lines.slice(start + 1, end).join('\n');
        return /trade-?off/i.test(text)
          ? pass('`### Decision` names the trade-off')
          : fail(
              '`### Decision` does not mention a trade-off',
              'state the trade-off that drove the choice',
            );
      },
    },
  ];
}

function completionChecks() {
  return [
    {
      id: 'tc-prefix',
      pattern: /Every item has a `TC-N` prefix/i,
      run: ({ doc }) => {
        const items = completionCriteria(doc.text);
        if (!items) return fail('no `## Completion Criteria` section', 'add the section');
        if (items.length === 0)
          return fail('`## Completion Criteria` has no checkbox items', 'add TC-NN criteria');
        const missing = items.filter((item) => !tcIdOf(item.text));
        return missing.length === 0
          ? pass(`${items.length} criteria, all \`TC-NN:\` prefixed`)
          : fail(
              `${missing.length} item(s) without a \`TC-NN:\` prefix: "${missing[0].text.slice(0, 50)}"`,
              'prefix every criterion with TC-NN:',
            );
      },
    },
    {
      id: 'banned-phrases',
      pattern: /No criterion uses:/i,
      run: ({ doc, criterion }) => {
        const banned = [...criterion.text.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
        const items = completionCriteria(doc.text) ?? [];
        const hits = [];
        for (const item of items) {
          for (const phrase of banned)
            if (item.text.toLowerCase().includes(phrase.toLowerCase()))
              hits.push(`${tcIdOf(item.text) ?? '?'}: "${phrase}"`);
        }
        return hits.length === 0
          ? pass(`none of ${banned.map((phrase) => `"${phrase}"`).join(', ')} appears`)
          : fail(hits.join('; '), 'rewrite the criterion in command or observable-behaviour form');
      },
    },
  ];
}

function testPlanChecks() {
  return [
    {
      id: 'test-plan-present',
      pattern: /`## Test Plan` section present/i,
      run: ({ doc }) =>
        sectionBody(doc.text, /^Test Plan$/i)
          ? pass('`## Test Plan` present')
          : fail('no `## Test Plan` section', 'add the section'),
    },
    {
      id: 'test-plan-rows-match',
      pattern: /One row exists for each TC-N/i,
      run: ({ doc }) => {
        const rows = testPlanRows(doc.text);
        const items = completionCriteria(doc.text) ?? [];
        if (!rows) return fail('no `## Test Plan` table', 'add the table');
        const tcIds = items.map((item) => tcIdOf(item.text)).filter(Boolean);
        const rowIds = rows.map((row) => row.id);
        const missing = tcIds.filter((id) => !rowIds.includes(id));
        const extra = rowIds.filter((id) => !tcIds.includes(id));
        if (missing.length === 0 && extra.length === 0 && rows.length === tcIds.length)
          return pass(`${rows.length} Test Plan rows = ${tcIds.length} TC criteria`);
        return fail(
          `${rows.length} rows vs ${tcIds.length} TC criteria${missing.length ? `; no row for ${missing.join(', ')}` : ''}${extra.length ? `; rows without a criterion: ${extra.join(', ')}` : ''}`,
          'one row per TC-NN, same ids',
        );
      },
    },
    {
      id: 'test-plan-cells',
      pattern: /non-empty Test Type and Tool/i,
      run: ({ doc }) => {
        const rows = testPlanRows(doc.text) ?? [];
        const bad = rows.filter(
          (row) => row.type === '' || row.tool === '' || /\bTBD\b/i.test(row.all),
        );
        return bad.length === 0
          ? pass(`${rows.length} rows with Test Type and Tool, no TBD`)
          : fail(
              `${bad.map((row) => row.id).join(', ')}: empty Test Type/Tool or "TBD"`,
              'fill in every row',
            );
      },
    },
    {
      id: 'test-plan-manual-notes',
      pattern: /Tool is "manual" have a non-empty Notes/i,
      run: ({ doc }) => {
        const rows = testPlanRows(doc.text) ?? [];
        const manual = rows.filter((row) => /\bmanual\b/i.test(row.tool));
        const bad = manual.filter((row) => row.notes.trim() === '');
        return bad.length === 0
          ? pass(`${manual.length} manual row(s), each with Notes`)
          : fail(
              `${bad.map((row) => row.id).join(', ')}: manual without Notes`,
              'explain why no automated test is possible',
            );
      },
    },
  ];
}

function structureChecks() {
  return [
    {
      id: 'tasks-section',
      pattern: /Tasks section present/i,
      run: ({ doc }) =>
        sectionBody(doc.text, /^Tasks$/i)
          ? pass('`## Tasks` present')
          : fail('no `## Tasks` section', 'add it with a placeholder'),
    },
    {
      id: 'evidence-log-section',
      pattern: /Evidence Log section present/i,
      run: ({ doc, gate }) => {
        const entries = evidenceEntries(doc.text);
        if (!entries) return fail('no `## Evidence Log` section', 'add it, empty');
        // Entries from this gate's own earlier runs (a FAIL being retried) and from the gates it
        // composes (an L1 PLAN run after `approve`) are expected; anything from a later gate is not.
        const expected = new Set([gate.name, ...gate.composes]);
        const foreign = entries.filter((entry) => entry.gate && !expected.has(entry.gate));
        return foreign.length === 0
          ? pass(
              `\`## Evidence Log\` present with ${entries.length} prior entr${entries.length === 1 ? 'y' : 'ies'} (none from a later gate)`,
            )
          : fail(
              `\`## Evidence Log\` already carries ${foreign.map((entry) => `[${entry.gate}]`).join(', ')}`,
              'a first GATE-WRITE run expects an empty log',
            );
      },
    },
    {
      id: 'no-status-body-sections',
      pattern: /No `## Status` or `## Classification` sections/i,
      run: ({ doc }) => {
        const found = ['Status', 'Classification'].filter((name) =>
          sectionBody(doc.text, new RegExp(`^${name}$`, 'i')),
        );
        return found.length === 0
          ? pass('no `## Status` / `## Classification` body sections')
          : fail(
              `body carries ${found.map((name) => `\`## ${name}\``).join(', ')}`,
              'move them to frontmatter fields',
            );
      },
    },
  ];
}

// GATE-APPROVAL ----------------------------------------------------------------------------------

function approvalContext(ctx) {
  if (ctx.cache.approval) return ctx.cache.approval;
  const ruleText = requireFile(ctx.backlogRule, 'backlog-execution rule');
  const section = parseRegistrySection(ruleText);
  if (!section)
    throw new Error('backlog-execution.md states no `### Delegated Approval Classes` section');
  const form = parseEvidenceForm(section);
  if (!form)
    throw new Error(
      'the approval evidence form in backlog-execution.md names no route/instruction/class field',
    );
  const registry = parseRegistry(section);
  if (!registry) throw new Error('backlog-execution.md carries no delegated-class registry table');
  const verdict = standingVerdict(ctx.doc.text);
  const parsed = verdict ? classifyApproval(verdict, { form, registry }) : null;
  ctx.cache.approval = { form, registry, verdict, parsed, section };
  return ctx.cache.approval;
}

function approvalParses(ctx) {
  const { verdict, parsed } = approvalContext(ctx);
  if (!verdict)
    return fail(
      'no standing `[GATE-APPROVAL] — ✅ PASS` entry in the Evidence Log',
      'run `gate.mjs approve` first',
    );
  if (parsed.problem)
    return fail(
      parsed.problem,
      'rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies',
    );
  return pass(
    parsed.route === 'DIRECT'
      ? 'standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply'
      : `standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date`,
  );
}

const shortSha = (text, length) =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, length);

/**
 * The fingerprint of what GATE-APPROVAL protects (REVIEW UNCHANGED SINCE APPROVAL in the header):
 * the `## Architecture Review` body and the top-level `type:` / `tags:` frontmatter lines, each
 * whitespace-normalised and hashed apart so a difference can be named, plus the combined hash the
 * field leads with. The rendered form is the exact value `approve` writes and the criterion reads.
 */
export function reviewFingerprint(text) {
  // The VALUES of `type:` and `tags:`, read through the frontmatter parser that owns multi-line
  // YAML (HARNESS-046): a block-sequence `tags:` puts its items on continuation lines, and hashing
  // only the key line let every item change without moving the fingerprint (PR #2419 review).
  const fm = frontmatterObject(String(text));
  const typeValue = asScalar(fm.type ?? '');
  const tagValues = asList(fm.tags ?? []).map((tag) => String(tag).trim());
  const typeTags = [`type=${typeValue}`, `tags=${tagValues.join(',')}`];
  const section = sectionBody(text, /^Architecture Review$/i);
  const normalise = (value) => value.replace(/\s+/g, ' ').trim();
  const review = shortSha(normalise(section ? section.body.join('\n') : ''), 8);
  const frontmatter = shortSha(normalise(typeTags.join('\n')), 8);
  const combined = shortSha(`${review}\n${frontmatter}`, 12);
  return {
    review,
    typeTags: frontmatter,
    combined,
    rendered: `${combined} (review ${review}, type/tags ${frontmatter})`,
  };
}

/** The fingerprint a GATE-APPROVAL entry records, or null when it carries no such field line. */
export function recordedReviewFingerprint(entryText) {
  const line = new RegExp(`^\\*\\*${REVIEW_FINGERPRINT_LABEL}:\\*\\*\\s*(.+)$`, 'm').exec(
    entryText,
  );
  if (!line) return null;
  const value = line[1].trim();
  const parts = /^([0-9a-f]{12})(?:\s*\(review ([0-9a-f]{8}), type\/tags ([0-9a-f]{8})\))?/.exec(
    value,
  );
  return {
    raw: value,
    combined: parts?.[1] ?? null,
    review: parts?.[2] ?? null,
    typeTags: parts?.[3] ?? null,
  };
}

/**
 * "No Architecture Review or frontmatter type/tags modified after approval" — the document's current
 * fingerprint against the one the standing entry recorded. No git, no dates: an untracked draft and
 * a same-day edit are judged the same way. An entry without the field is the guardian's to judge.
 */
function architectureUnchangedSinceApproval(ctx) {
  const { verdict } = approvalContext(ctx);
  if (!verdict)
    return fail(
      'no standing GATE-APPROVAL entry to compare the review against',
      'run `gate.mjs approve` first',
    );
  const recorded = recordedReviewFingerprint(verdict);
  if (!recorded)
    return pending(
      `the standing GATE-APPROVAL entry carries no \`**${REVIEW_FINGERPRINT_LABEL}:**\` line — written by hand rather than by \`gate.mjs approve\`, so nothing records the review that was approved`,
    );
  const current = reviewFingerprint(ctx.doc.text);
  if (recorded.combined === current.combined)
    return pass(
      `the \`**${REVIEW_FINGERPRINT_LABEL}:**\` recorded at approval (${recorded.combined}) equals the document's current fingerprint`,
    );
  const changed = [];
  if (recorded.review !== null && recorded.review !== current.review)
    changed.push(
      `the Architecture Review section changed since the approval (${recorded.review} → ${current.review})`,
    );
  if (recorded.typeTags !== null && recorded.typeTags !== current.typeTags)
    changed.push(
      `the frontmatter type/tags lines changed since the approval (${recorded.typeTags} → ${current.typeTags})`,
    );
  if (changed.length === 0)
    changed.push(
      `the review fingerprint changed since the approval (${recorded.combined} → ${current.combined}; the entry records no per-part hashes to name which)`,
    );
  return fail(changed.join('; '), 're-run approve on the revised review');
}

/** Route DIRECT's "explicit approval in the current conversation", as the standing entry records it. */
function directApprovalRecorded(ctx) {
  const { verdict, parsed, form } = approvalContext(ctx);
  if (!verdict)
    return fail('no standing `[GATE-APPROVAL] — ✅ PASS` entry', 'run `gate.mjs approve` first');
  if (parsed.problem)
    return fail(parsed.problem, 'rewrite the entry in the delegated-approval form');
  if (parsed.route === 'CLASS')
    return pass('route CLASS, so the Route DIRECT criterion does not apply');
  const given = /^\*\*Given:\*\*\s*(.+)$/m.exec(verdict)?.[1] ?? '';
  return /this conversation/i.test(given)
    ? pass(`route DIRECT; \`**${form.instruction}:**\` recorded, given ${given}`)
    : fail(
        `route DIRECT but \`**Given:**\` reads "${given}" rather than naming this conversation`,
        'record the date and "this conversation"',
      );
}

/** Route CLASS's evidence condition: the entry carries a measurement line, not an assertion. */
function classConditionMeasured(ctx) {
  const { verdict, parsed } = approvalContext(ctx);
  if (!verdict)
    return fail('no standing `[GATE-APPROVAL] — ✅ PASS` entry', 'run `gate.mjs approve` first');
  if (parsed.problem)
    return fail(parsed.problem, 'rewrite the entry in the delegated-approval form');
  if (parsed.route === 'DIRECT')
    return pass('route DIRECT, so the Route CLASS criterion does not apply');
  const condition = /^\*\*Evidence condition met:\*\*\s*(.+)$/m.exec(verdict)?.[1]?.trim() ?? '';
  if (condition === '')
    return fail(
      'route CLASS with no `**Evidence condition met:**` line',
      'record the measurement with its command and output',
    );
  return /`[^`]+`|\d/.test(condition)
    ? pass(`route CLASS; evidence condition recorded as a measurement (${condition.slice(0, 60)})`)
    : fail(
        `\`**Evidence condition met:**\` carries no command or number — an assertion, not a measurement: "${condition.slice(0, 60)}"`,
        'record the command and its output',
      );
}

function approvalChecks() {
  return [
    {
      id: 'direct-approval-recorded',
      pattern: /explicit approval in the current conversation/i,
      run: directApprovalRecorded,
    },
    {
      id: 'class-registered',
      pattern: /named class exists in the delegated-class registry/i,
      run: approvalParses,
    },
    {
      id: 'instruction-verbatim',
      pattern: /authorising instruction is recorded verbatim/i,
      run: approvalParses,
    },
    {
      id: 'class-condition-measured',
      pattern: /evidence condition is shown to be met by measurement/i,
      run: classConditionMeasured,
    },
    {
      id: 'no-review-change-after-approval',
      pattern: /No Architecture Review or frontmatter type\/tags modified after approval/i,
      run: architectureUnchangedSinceApproval,
    },
  ];
}

// GATE-IMPLEMENT ---------------------------------------------------------------------------------

function taskContext(ctx) {
  if (ctx.cache.task !== undefined) return ctx.cache.task;
  const rel = taskPathFromSpec(ctx.doc.text);
  const abs = rel ? path.resolve(ctx.root, rel) : null;
  const text = abs && existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  ctx.cache.task = { rel, abs, text };
  return ctx.cache.task;
}

function taskExists(ctx) {
  const task = taskContext(ctx);
  if (!task.rel)
    return fail(
      '`## Tasks` names no `.agents/tasks/<ID>.md` path',
      'record the Task path in `## Tasks`',
    );
  if (!/^\.agents\/tasks\/[^/]+\.md$/.test(task.rel))
    return fail(
      `\`## Tasks\` names \`${task.rel}\`, which is not an active root Task path`,
      'record the active Task at `.agents/tasks/<ID>.md` rather than an archived or nested path',
    );
  if (task.text === null)
    return fail(`\`## Tasks\` names \`${task.rel}\`, which does not exist`, 'create the Task file');
  return pass(`\`## Tasks\` names \`${task.rel}\`, which exists`);
}

/** The recorded Task path pairs with the spec by basename — the binding the plan-order scan reads. */
function taskPathRecorded(ctx) {
  const task = taskContext(ctx);
  if (!task.rel)
    return fail(
      '`## Tasks` names no `.agents/tasks/<ID>.md` path',
      'record the Task path in `## Tasks`',
    );
  const specBase = path.basename(ctx.doc.path);
  if (path.basename(task.rel) !== specBase)
    return fail(
      `\`## Tasks\` names \`${task.rel}\`, whose basename is not the spec's (${specBase})`,
      'pair the Task and the spec by basename',
    );
  return pass(`\`## Tasks\` names \`${task.rel}\`, whose basename is the spec's`);
}

function taskCheckboxes(text) {
  return checkboxItems(String(text).split('\n'));
}

function implementChecks() {
  return [
    {
      id: 'task-created',
      pattern: /`\.agents\/tasks\/<ID>\.md` has been created/i,
      run: taskExists,
    },
    {
      id: 'task-path-recorded',
      pattern: /Tasks file path is recorded in the `## Tasks` section/i,
      run: taskPathRecorded,
    },
    {
      id: 'tasks-cover-tc',
      pattern: /Tasks in the file correspond to the Completion Criteria/i,
      run: (ctx) => {
        const task = taskContext(ctx);
        if (task.text === null) return fail('no Task file to read', 'create the Task file');
        const tcIds = (completionCriteria(ctx.doc.text) ?? [])
          .map((item) => tcIdOf(item.text))
          .filter(Boolean);
        const mentioned = tcIds.filter((id) => task.text.includes(id));
        const boxes = taskCheckboxes(task.text).length;
        if (mentioned.length === tcIds.length)
          return pass(`Task names every TC id (${tcIds.length})`);
        if (boxes >= tcIds.length)
          return pass(`Task carries ${boxes} checkbox tasks for ${tcIds.length} criteria`);
        return fail(
          `Task names ${mentioned.length}/${tcIds.length} TC ids and carries ${boxes} checkbox task(s)`,
          'one task per TC-N',
        );
      },
    },
    {
      id: 'task-test-plan',
      pattern: /tasks file includes a `## Test Plan`/i,
      run: (ctx) => {
        const task = taskContext(ctx);
        if (task.text === null) return fail('no Task file to read', 'create the Task file');
        const section = sectionBody(task.text, /^(Test Plan|Testing|검증)$/i);
        const length = section ? section.body.join('\n').trim().length : 0;
        return length >= 50
          ? pass(`Task \`## ${section.heading.replace(/^##\s+/, '')}\` is ${length} chars`)
          : fail(
              `Task Test Plan/Testing section is ${length} chars (${section ? 'too short' : 'absent'})`,
              'write a ≥50-char test plan in the Task',
            );
      },
    },
    {
      id: 'plan-outcome',
      pattern: /user-execution PLAN terminal outcome/i,
      run: (ctx) => {
        const task = taskContext(ctx);
        if (task.text === null) return fail('no Task file to read', 'create the Task file');
        // Exactly one author-verdict line under the scenarios section: the form the plan-order scan
        // binds the checkpoint to, so a Task that would fail that scan fails here first.
        const section = sectionBody(task.text, /^User Execution Test Scenarios$/i);
        const signals = [...(section?.body.join('\n') ?? '').matchAll(AUTHOR_VERDICT_LINE)];
        const form =
          '`**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line';
        if (signals.length === 0)
          return fail(
            `Task \`## User Execution Test Scenarios\` carries no ${form} (0 found, exactly 1 required${section ? '' : '; the section is absent'})`,
            'record the author verdict in the Task',
          );
        if (signals.length > 1)
          return fail(
            `Task \`## User Execution Test Scenarios\` carries ${signals.length} ${form}s (exactly 1 required)`,
            'keep one author verdict',
          );
        if (signals[0][1] === 'not-applicable') {
          const validated = validateNotApplicablePlan(
            requireFile(ctx.backlogRule, 'backlog-execution rule'),
            task.text,
          );
          if (!validated.ok) {
            return fail(
              `not-applicable PLAN ${validated.error}`,
              'record one visible substantive **Reason:** field',
            );
          }
        }
        return pass(
          `Task \`## User Execution Test Scenarios\` records \`SCENARIO DRAFTED: ${signals[0][1]} | ${signals[0][2]}\``,
        );
      },
    },
    {
      id: 'worktree-inventory',
      pattern: /whole worktree contains no staged, unstaged, untracked/i,
      run: (ctx) => {
        const status = git(ctx.root, ['status', '--porcelain', '--untracked-files=all']);
        if (!status.ok)
          return fail(
            `git status failed in ${ctx.root}: ${status.stderr.trim().split('\n')[0]}`,
            'run inside the git worktree',
          );
        const task = taskContext(ctx);
        const allowed = new Set([path.relative(ctx.root, ctx.doc.path), task.rel].filter(Boolean));
        const paths = status.stdout
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => line.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, ''));
        const outside = paths.filter(
          (file) => !allowed.has(file) && !file.startsWith(PLAN_LEDGER_DIR),
        );
        return outside.length === 0
          ? pass(
              `worktree inventory: ${paths.length} path(s), all within the paired spec/Task and ${PLAN_LEDGER_DIR}`,
            )
          : fail(
              `${outside.length} path(s) outside the paired spec/Task: ${outside.slice(0, 5).join(', ')}`,
              'commit, stash, or remove them before this gate',
            );
      },
    },
  ];
}

// GATE-VERIFY ------------------------------------------------------------------------------------

function allTasksComplete(ctx) {
  const task = taskContext(ctx);
  if (task.text === null) return fail('no Task file to read', 'record and create the Task');
  const boxes = taskCheckboxes(task.text);
  const open = boxes.filter((box) => !box.checked);
  if (open.length > 0)
    return fail(
      `${open.length}/${boxes.length} task(s) unticked in ${task.rel}: "${open[0].text.slice(0, 50)}"`,
      'complete and tick every task',
    );
  return boxes.length === 0
    ? pass(`${task.rel} carries no checkbox plan (a Task is the problem record, not a breakdown)`)
    : pass(`${boxes.length}/${boxes.length} tasks \`[x]\` in ${task.rel}`);
}

function verifyCommands(ctx) {
  if (ctx.cache.verify) return ctx.cache.verify;
  const commands = ctx.verifyCmds ?? [];
  const results = commands.map((command) => {
    const run = spawnSync(command, { cwd: ctx.root, shell: true, encoding: 'utf8' });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n');
    return { command, exit: run.status ?? -1, tail: output.slice(-3).join(' ⏎ ') };
  });
  ctx.cache.verify = results;
  return results;
}

function commandSummary(results) {
  return results
    .map(
      (result) =>
        `\`${result.command}\` → exit ${result.exit}${result.tail ? ` (${result.tail})` : ''}`,
    )
    .join('; ');
}

/**
 * A GATE-VERIFY command criterion: at least one supplied command has the criterion's shape (VERIFY
 * COMMAND SHAPE in the header), every supplied command is recorded verbatim, and all exit 0.
 */
function verifyCommandsShaped(kind, shape, label) {
  return (ctx) => {
    const results = verifyCommands(ctx);
    if (results.length === 0)
      return fail(
        'no `--verify-cmd` supplied, so nothing was run',
        'pass the build/test command(s) via --verify-cmd',
      );
    const shaped = results.filter((result) => shape.test(result.command));
    if (shaped.length === 0)
      return fail(
        `no supplied --verify-cmd contains ${label} (supplied: ${commandSummary(results)})`,
        `pass a ${kind} command via --verify-cmd`,
      );
    const failed = results.filter((result) => result.exit !== 0);
    if (failed.length > 0) return fail(commandSummary(results), 'make every verify command exit 0');
    return pass(
      `${kind}-shaped ${commandSummary(shaped)}${results.length > shaped.length ? `; all ${results.length} supplied commands exit 0` : ''}`,
    );
  };
}

function verifyChecks() {
  return [
    {
      id: 'tasks-complete',
      pattern: /All tasks in `\.agents\/tasks\/<ID>\.md` are marked complete/i,
      run: allTasksComplete,
    },
    {
      id: 'no-blocked',
      pattern: /No tasks are blocked or pending/i,
      run: (ctx) => {
        const task = taskContext(ctx);
        if (task.text === null) return fail('no Task file to read', 'record and create the Task');
        const flagged = taskCheckboxes(task.text).filter(
          (box) => !box.checked || /\b(blocked|pending)\b/i.test(box.text),
        );
        return flagged.length === 0
          ? pass('no unticked, blocked, or pending task')
          : fail(
              `${flagged.length} task(s) unticked/blocked/pending: "${flagged[0].text.slice(0, 50)}"`,
              'resolve or re-plan them',
            );
      },
    },
    {
      id: 'build-passes',
      pattern: /Build passes/i,
      run: verifyCommandsShaped(
        'build',
        BUILD_COMMAND_SHAPE,
        '`build`, `harness:scan` or `run-all-scans`',
      ),
    },
    {
      id: 'tests-pass',
      pattern: /Tests pass/i,
      run: verifyCommandsShaped('test', TEST_COMMAND_SHAPE, '`test` or `vitest`'),
    },
  ];
}

// GATE-COMPLETE ----------------------------------------------------------------------------------

function tcCheckboxesTicked(ctx) {
  const items = completionCriteria(ctx.doc.text);
  if (!items || items.length === 0)
    return fail('no TC criteria in `## Completion Criteria`', 'add them');
  const open = items.filter((item) => !item.checked);
  return open.length === 0
    ? pass(`${items.length}/${items.length} TC checkboxes \`[x]\``)
    : fail(
        `${open.map((item) => tcIdOf(item.text) ?? '?').join(', ')} unticked`,
        'verify and tick every TC',
      );
}

function tcEntriesExist(ctx) {
  const items = completionCriteria(ctx.doc.text) ?? [];
  const entries = evidenceEntries(ctx.doc.text) ?? [];
  const missing = [];
  const thin = [];
  for (const item of items) {
    const id = tcIdOf(item.text);
    if (!id) continue;
    const entry = entries.filter((candidate) => candidate.gate === `GATE-COMPLETE: ${id}`).pop();
    if (!entry) {
      missing.push(id);
      continue;
    }
    const body = entry.lines.join('\n');
    if (!/\*\*(Command|Action|Test skipped)[^*]*:\*\*/.test(body)) thin.push(id);
  }
  if (missing.length > 0)
    return fail(
      `no \`[GATE-COMPLETE: TC-N]\` entry for ${missing.join(', ')}`,
      'run `gate.mjs record` for each',
    );
  if (thin.length > 0)
    return fail(
      `${thin.join(', ')} entries carry no **Command:**/**Action:**/**Test skipped:** line`,
      'record the command and its output',
    );
  return pass(
    `a \`[GATE-COMPLETE: TC-N]\` entry with command/output exists for every TC (${items.length})`,
  );
}

function testReferencesRecorded(ctx) {
  const rows = testPlanRows(ctx.doc.text);
  if (!rows) return fail('no `## Test Plan` table', 'add it');
  const entries = evidenceEntries(ctx.doc.text) ?? [];
  const testRef = /(\.test\.[cm]?[jt]sx?|__tests__\/|\bskip(ped)?\b|manual)/i;
  const unaddressed = rows.filter((row) => {
    const entry = entries
      .filter((candidate) => candidate.gate === `GATE-COMPLETE: ${row.id}`)
      .pop();
    return !testRef.test(row.all) && !(entry && testRef.test(entry.lines.join('\n')));
  });
  return unaddressed.length === 0
    ? pass(`every Test Plan row (${rows.length}) carries a test reference or a skip reason`)
    : fail(
        `${unaddressed.map((row) => row.id).join(', ')}: no test reference and no skip reason`,
        'name the test or record why it was skipped',
      );
}

function completeChecks() {
  return [
    { id: 'tc-checked', pattern: /The checkbox is checked/i, run: tcCheckboxesTicked },
    {
      id: 'tc-entry',
      pattern: /`\[GATE-COMPLETE: TC-N\]` Evidence Log entry exists/i,
      run: tcEntriesExist,
    },
    {
      id: 'test-ref-or-skip',
      pattern: /One of the following is recorded/i,
      run: testReferencesRecorded,
    },
    {
      id: 'no-silent-tc',
      pattern: /No TC-N is silently unaddressed/i,
      run: testReferencesRecorded,
    },
    {
      id: 'all-tc-checked',
      pattern: /`## Completion Criteria` checkboxes are all `\[x\]`/i,
      run: tcCheckboxesTicked,
    },
    {
      id: 'test-plan-updated',
      pattern: /`## Test Plan` updated with test references/i,
      run: testReferencesRecorded,
    },
    {
      id: 'tasks-names-active-task',
      pattern: /`## Tasks` section names the exact active task path/i,
      run: taskExists,
    },
    {
      id: 'task-completion-ready',
      pattern: /active task exists and is completion-ready/i,
      run: allTasksComplete,
    },
  ];
}

export const JUDGEMENTS = Object.freeze({
  'GATE-WRITE': [
    ...frontmatterChecks(),
    ...problemChecks(),
    ...priorArtChecks(),
    ...architectureChecks(),
    ...completionChecks(),
    ...testPlanChecks(),
    ...structureChecks(),
  ],
  'GATE-APPROVAL': approvalChecks(),
  'GATE-IMPLEMENT': implementChecks(),
  'GATE-VERIFY': verifyChecks(),
  'GATE-COMPLETE': completeChecks(),
});

// ── judge ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The lane the judgement runs under (THE DOCUMENT'S `lane:` IS AUTHORITATIVE in the header): the
 * frontmatter's, which `--lane` may only equal — or set, when the frontmatter declares none.
 */
export function resolveLane(options, doc) {
  const normalise = (value) => (value == null ? null : String(value).trim().toUpperCase());
  const declared = normalise(doc.fm.lane);
  const requested = normalise(options.lane);
  for (const [label, value] of [
    ["the document's `lane:`", declared],
    ['--lane', requested],
  ])
    if (value !== null && !/^L[12]$/.test(value))
      throw new Error(`refused: ${label} is \`${value}\`, not L1 or L2`);
  if (declared !== null && requested !== null && requested !== declared)
    throw new Error(
      `refused: --lane ${requested} ${requested < declared ? 'is below' : 'does not equal'} the document's \`lane: ${declared}\` — the frontmatter lane is authoritative; pass --lane ${declared} or omit it`,
    );
  return declared ?? requested ?? 'L2';
}

function resolveGate(options, doc) {
  const requested = options.gate;
  if (!requested) throw new Error('judge needs --gate');
  const lane = resolveLane(options, doc);
  if (lane === 'L1') {
    const composite = Object.entries(LANE_L1).find(([, spec]) => spec.aliases.includes(requested));
    if (composite)
      return {
        name: composite[0],
        composes: composite[1].composes,
        select: composite[1].select,
        upgrade: composite[1].upgrade,
        prior: composite[1].prior,
        lane,
      };
  }
  if (!SPEC_GATES.includes(requested)) {
    throw new Error(
      `unknown gate ${requested}; expected one of ${SPEC_GATES.join(', ')}${lane === 'L1' ? ', PLAN, DONE' : ''}`,
    );
  }
  const continuation = resolveContinuationGate(options, requested, lane);
  if (continuation) return continuation;
  return {
    name: requested,
    composes: [requested],
    select: {},
    upgrade: null,
    prior: undefined,
    lane,
  };
}

/**
 * Bind every criterion of the composed gates to a verdict. Pure over `ctx`, exported for tests.
 *
 * Verdicts: `PASS` / `FAIL` from a bound judgement; `N/A` for a semantic criterion under lane L1
 * (PASS-class — the lane does not require it); `PENDING-GUARDIAN` for a semantic criterion under L2
 * and, in every lane, for an untagged criterion or a mechanical one with no judgement bound.
 */
export function judgeCriteria(catalogue, gate, ctx) {
  const results = [];
  for (const gateName of gate.composes) {
    const section = catalogue.gates.get(gateName);
    if (!section) throw new Error(`the catalogue states no \`### ${gateName}\` section`);
    if (section.criteria.length === 0)
      throw new Error(`the catalogue's \`### ${gateName}\` section carries no checkbox criteria`);
    // GATE-APPROVAL's criteria read the entry `approve` writes. While none exists they are not a
    // defect in the document but a step not yet run, so they are pending, never FAIL — a ❌ entry
    // for "approve has not run" would only be retried by running approve.
    const approvePending = gateName === 'GATE-APPROVAL' && !standingVerdict(ctx.doc.text);
    // A composite gate may take only SOME of a section's judgements (PLAN's THIRD SET), selected by
    // the id their wording binds; every selected id must be found or the composition is refused.
    const selected = gate.select?.[gateName] ?? null;
    const found = new Set();
    for (const criterion of section.criteria) {
      const label = `${gateName} — ${criterion.text.replace(/\s+/g, ' ').slice(0, 110)}`;
      if (selected) {
        const bound =
          criterion.tag === 'mechanical'
            ? JUDGEMENTS[gateName].find((candidate) => candidate.pattern.test(criterion.text))
            : null;
        if (!bound || !selected.includes(bound.id)) continue;
        found.add(bound.id);
      }
      if (approvePending) {
        results.push({
          gate: gateName,
          criterion,
          label,
          verdict: 'PENDING-APPROVE',
          observed: APPROVE_FIRST,
        });
        continue;
      }
      if (criterion.tag !== 'mechanical') {
        const notRequired = gate.lane === 'L1' && criterion.tag === 'semantic';
        results.push({
          gate: gateName,
          criterion,
          label,
          verdict: notRequired ? 'N/A' : 'PENDING-GUARDIAN',
          observed: notRequired
            ? L1_NOT_REQUIRED
            : criterion.tag === null
              ? 'untagged in the catalogue — treated as semantic'
              : 'semantic criterion',
        });
        continue;
      }
      const judgement = JUDGEMENTS[gateName].find((candidate) =>
        candidate.pattern.test(criterion.text),
      );
      if (!judgement) {
        results.push({
          gate: gateName,
          criterion,
          label,
          verdict: 'PENDING-GUARDIAN',
          observed:
            'tagged mechanical, but gate.mjs binds no judgement to this wording — treated as semantic',
        });
        continue;
      }
      let outcome;
      try {
        outcome = judgement.run({ ...ctx, criterion, criterionGate: gateName });
      } catch (error) {
        outcome = fail(
          `judgement ${judgement.id} threw: ${error.message}`,
          'fix the input the judgement could not read',
        );
      }
      results.push({
        gate: gateName,
        criterion,
        label,
        verdict: outcome.pending ? 'PENDING-GUARDIAN' : outcome.ok ? 'PASS' : 'FAIL',
        observed: outcome.observed,
        action: outcome.action,
        id: judgement.id,
      });
    }
    if (selected) {
      const missing = selected.filter((id) => !found.has(id));
      if (missing.length > 0)
        throw new Error(
          `the catalogue's \`### ${gateName}\` section carries no mechanical criterion bound to ${missing.join(', ')} — ${gate.name} composes those judgements by wording and cannot run with fewer`,
        );
    }
  }
  return results;
}

function orderingResult(catalogue, gate, doc) {
  const prior =
    gate.prior === undefined ? catalogue.priorGates.get(gate.priorKey ?? gate.name) : gate.prior;
  if (!prior) return null;
  const entries = (evidenceEntries(doc.text) ?? []).filter((entry) => entry.gate === prior.gate);
  const retriesFromLatestPass = gate.continuation || gate.correction;
  const last = entries.findLast((entry) => !retriesFromLatestPass || entry.verdict === '✅ PASS');
  const problems = [];
  if (!last || last.verdict !== '✅ PASS')
    problems.push(
      `${retriesFromLatestPass ? `no prior [${prior.gate}] PASS entry exists; last entry` : `last [${prior.gate}] entry`} is ${entries.at(-1)?.verdict ?? 'absent'}${retriesFromLatestPass ? '' : ', PASS required'}`,
    );
  if (prior.status && doc.fm.status !== prior.status)
    problems.push(`status is \`${doc.fm.status ?? '(absent)'}\`, \`${prior.status}\` expected`);
  return {
    gate: gate.name,
    label: `${gate.name} — ordering: prior gate ${prior.gate} PASS${prior.status ? ` and status \`${prior.status}\`` : ''}`,
    verdict: problems.length === 0 ? 'PASS' : 'FAIL',
    observed:
      problems.length === 0
        ? `[${prior.gate}] — ✅ PASS | ${last.date}${prior.status ? `; status \`${doc.fm.status}\`` : ''}`
        : problems.join('; '),
    action: 'run the prior gate to PASS first',
  };
}

function passEntry(gateName, date, upgrade, results) {
  return [
    `### [${gateName}] — ✅ PASS | ${date}`,
    '',
    `**Status upgrade:** ${upgrade.from} → ${upgrade.to}`,
    '',
    ...results.map((result) => `- ${result.label}: ${result.observed}`),
  ];
}

function failEntry(gateName, date, current, failed) {
  return [
    `### [${gateName}] — ❌ FAIL | ${date}`,
    '',
    `**Status remains:** ${current}`,
    '**Failed criteria:**',
    '',
    ...failed.flatMap((result) => [
      `- ${result.label}: ${result.observed}`,
      `  **Required action:** ${result.action ?? 'satisfy the criterion and re-run the gate'}`,
    ]),
  ];
}

/**
 * GATE-APPROVAL's PASS is written INTO the entry `approve` created rather than after it: the
 * standing-delegation scan reads the LAST `[GATE-APPROVAL] — ✅ PASS`, so a second PASS heading
 * without the route fields would retire the one that carries them. The result lines `approve` already
 * judged into the entry are replaced, not duplicated.
 */
function mergeIntoLastApprovalEntry(text, lines) {
  const entries = evidenceEntries(text);
  const last = entries?.[entries.length - 1];
  if (!last || last.gate !== 'GATE-APPROVAL' || last.verdict !== '✅ PASS') return null;
  const docLines = text.split('\n');
  const start = docLines.findIndex((line) => /^##\s+Evidence Log\s*$/i.test(line));
  const end = sectionEnd(docLines, start);
  const headingAt = docLines.lastIndexOf(last.heading, end);
  const kept = docLines.slice(headingAt, end).filter((line) => !/^- GATE-APPROVAL — /.test(line));
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  return [...docLines.slice(0, headingAt), ...kept, '', ...lines, '', ...docLines.slice(end)]
    .join('\n')
    .replace(/\n+$/, '\n');
}

export function runJudge(options) {
  const root = path.resolve(options.root ?? WORKSPACE_ROOT);
  if (!options.doc) throw new Error('judge needs --doc');
  const docPath = resolveFrom(root, options.doc, '');
  const doc = loadDocument(docPath);
  const catalogue = parseCatalogue(
    requireFile(resolveFrom(root, options.catalogue, DEFAULT_CATALOGUE), 'gate catalogue'),
  );
  const gate = resolveGate(options, doc);
  const date = today(options);
  const ctx = {
    doc,
    gate,
    root,
    cache: {},
    backlogRule: resolveFrom(root, options['backlog-rule'], DEFAULT_BACKLOG_RULE),
    verifyCmds: options['verify-cmd'] ?? [],
  };

  const ordering = orderingResult(catalogue, gate, doc);
  const results = [...(ordering ? [ordering] : []), ...judgeCriteria(catalogue, gate, ctx)];
  const lines = results.map(
    (result) => `${result.verdict.padEnd(16)} ${result.label} — ${result.observed}`,
  );
  const failed = results.filter((result) => result.verdict === 'FAIL');
  const pendingGuardian = results.filter((result) => result.verdict === 'PENDING-GUARDIAN');
  const pendingApprove = results.filter((result) => result.verdict === 'PENDING-APPROVE');
  const pending = [...pendingGuardian, ...pendingApprove];
  const notRequired = results.filter((result) => result.verdict === 'N/A');
  // No examined-size declaration line: this is a command, not a registered scan, and a
  // self-reported size nothing reads is what `measurement-provenance` refuses. The count is part
  // of the summary instead. N/A is PASS-class for the verdict but counted apart, so the summary
  // says how many criteria the lane excused rather than folding them into what was judged.
  const passed = results.length - failed.length - pending.length - notRequired.length;
  const summary = `gate ${gate.name} (lane ${gate.lane}): ${results.length} criteria judged — ${passed} PASS, ${notRequired.length > 0 ? `${notRequired.length} N/A (lane ${gate.lane}), ` : ''}${failed.length} FAIL, ${pendingGuardian.length} PENDING-GUARDIAN${pendingApprove.length > 0 ? `, ${pendingApprove.length} PENDING-APPROVE` : ''}`;

  let verdict;
  let entry = null;
  if (failed.length > 0) {
    verdict = EXIT_FAIL;
    entry = failEntry(gate.name, date, doc.fm.status ?? '(absent)', failed);
  } else if (pending.length > 0) {
    verdict = EXIT_PENDING;
  } else {
    verdict = EXIT_PASS;
    const upgrade = gate.upgrade
      ? { from: gate.upgrade[0], to: gate.upgrade[1] }
      : catalogue.gates.get(gate.name)?.upgrade;
    if (!upgrade)
      throw new Error(
        `the catalogue heading for ${gate.name} states no \`from → to\` status upgrade`,
      );
    entry = passEntry(gate.name, date, upgrade, results);
    if (gate.name === 'GATE-IMPLEMENT') {
      const task = taskContext(ctx);
      const evidenceInput = {
        root: ctx.root,
        ruleText: requireFile(ctx.backlogRule, 'backlog-execution rule'),
        specText: ctx.doc.text,
        taskText: task.text,
        taskRel: task.rel,
        specRel: path.relative(ctx.root, ctx.doc.path).split(path.sep).join('/'),
      };
      entry.push(
        '',
        ...(gate.correction
          ? renderCorrectionCheckpointEvidence(evidenceInput)
          : gate.continuation
            ? renderContinuationCheckpointEvidence(evidenceInput)
            : renderFirstCheckpointEvidence(evidenceInput)),
      );
    }
  }

  let written = false;
  if (entry && !options['dry-run']) {
    const merged =
      gate.name === 'GATE-APPROVAL' && verdict === EXIT_PASS
        ? mergeIntoLastApprovalEntry(doc.text, entry.slice(4))
        : null;
    writeFileSync(docPath, merged ?? appendToEvidenceLog(doc.text, entry));
    written = true;
  }
  return {
    exit: verdict,
    lines,
    summary,
    entry,
    written,
    results,
    examined: results.length,
    approvePending: pendingApprove.length,
  };
}

// ── record ───────────────────────────────────────────────────────────────────────────────────────

export function runRecord(options) {
  const root = path.resolve(options.root ?? WORKSPACE_ROOT);
  if (!options.doc) throw new Error('record needs --doc');
  const tc = options.tc;
  if (!/^TC-\d{2,}$/.test(tc ?? '')) throw new Error('record needs --tc TC-NN');
  const docPath = resolveFrom(root, options.doc, '');
  const doc = loadDocument(docPath);
  const date = today(options);
  let lines;
  if (options.skip) {
    lines = [
      `### [GATE-COMPLETE: ${tc}] — ✅ PASS | ${date}`,
      '',
      `**Test skipped:** ${options.skip}`,
    ];
  } else {
    if (!options.command || options.exit === undefined || !options['output-file'])
      throw new Error('record needs --command, --exit and --output-file (or --skip "<reason>")');
    const exit = Number(options.exit);
    if (!Number.isInteger(exit)) throw new Error('--exit must be an integer');
    const output = requireFile(resolveFrom(root, options['output-file'], ''), 'output file')
      .trim()
      .split('\n');
    const tail = output.slice(-10);
    lines = [
      `### [GATE-COMPLETE: ${tc}] — ${exit === 0 ? '✅ PASS' : '❌ FAIL'} | ${date}`,
      '',
      `**Command:** \`${options.command}\``,
      `**Exit:** ${exit}`,
      `**Output:** (last ${tail.length} of ${output.length} line(s))`,
      '',
      '```',
      ...tail,
      '```',
    ];
  }
  writeFileSync(docPath, appendToEvidenceLog(doc.text, lines));
  return { exit: 0, lines };
}

// ── advance ──────────────────────────────────────────────────────────────────────────────────────

export function runAdvance(options) {
  const root = path.resolve(options.root ?? WORKSPACE_ROOT);
  if (!options.doc) throw new Error('advance needs --doc');
  const docPath = resolveFrom(root, options.doc, '');
  const doc = loadDocument(docPath);
  const entries = evidenceEntries(doc.text);
  if (!entries || entries.length === 0)
    throw new Error('refused: the Evidence Log carries no entry to advance on');
  const last = entries[entries.length - 1];
  if (last.verdict !== '✅ PASS')
    throw new Error(
      `refused: the last Evidence Log entry is ${last.verdict ?? 'unparseable'} (${last.heading.trim()}), not a PASS`,
    );
  const upgrade = statusUpgradeOf(last);
  if (!upgrade)
    throw new Error(
      `refused: the last entry [${last.gate}] carries no \`**Status upgrade:** <current> → <next>\` line`,
    );
  // APPROVE EARNS ITS VERDICT (header): a heading and an upgrade line with nothing judged under them
  // is the shape approve → advance used to reach `approved` by.
  if (!last.lines.some((line) => /^- [A-Z][A-Z-]* — .+: .+/.test(line)))
    throw new Error(
      `refused: the last entry [${last.gate}] carries no per-criterion result line (\`- <GATE> — <criterion>: <observed>\`) — a heading and a Status upgrade alone is not a judged gate`,
    );
  if (doc.fm.status !== upgrade.from)
    throw new Error(
      `refused: frontmatter is \`status: ${doc.fm.status ?? '(absent)'}\` but the entry upgrades from \`${upgrade.from}\``,
    );

  const mapping = parseStatusFolderMapping(
    requireFile(resolveFrom(root, options.rule, DEFAULT_RULE), 'spec-workflow rule'),
  );
  if (mapping.size === 0)
    throw new Error('refused: the status ↔ folder table in spec-workflow.md is unreadable');
  const folder = mapping.get(upgrade.to);
  if (!folder)
    throw new Error(`refused: spec-workflow.md maps no folder for status \`${upgrade.to}\``);

  const { target, moved } = vacantAdvanceDestination(root, docPath, folder);

  const taskRel = taskPathFromSpec(doc.text);
  let activatedTask = null;
  if (
    last.gate === 'GATE-IMPLEMENT' &&
    upgrade.from === 'approved' &&
    upgrade.to === 'in-progress'
  ) {
    if (!taskRel) {
      throw new Error('refused: GATE-IMPLEMENT PASS names no paired active Task');
    }
    activatedTask = prepareTaskActivation(root, taskRel);
  }

  const notes = [];
  writeFileSync(docPath, rewriteFrontmatterStatus(doc.text, upgrade.to));
  if (moved) {
    mkdirSync(path.dirname(target), { recursive: true });
    const rel = path.relative(root, docPath);
    // A draft git does not track yet (or a root that is no repository) has nothing for `git mv` to
    // move; a plain rename is the right tool there, said once, not reported as a refusal.
    const tracked = git(root, ['ls-files', '--error-unmatch', '--', rel]);
    if (!tracked.ok) {
      renameSync(docPath, target);
      notes.push(`moved with rename (${rel} is not tracked by git)`);
    } else {
      const mv = git(root, ['mv', rel, path.relative(root, target)]);
      if (mv.ok) notes.push('moved with git mv');
      else {
        renameSync(docPath, target);
        notes.push(
          `moved with rename (git mv refused: ${mv.stderr.trim().split('\n')[0] || 'not a git path'})`,
        );
      }
    }
  }
  if (activatedTask !== null) {
    writeFileSync(activatedTask.path, activatedTask.text);
    notes.push(`activated ${taskRel} to in-progress with the spec`);
  }
  if (moved && taskRel) {
    const oldRel = path.relative(root, docPath).split(path.sep).join('/');
    const newRel = path.relative(root, target).split(path.sep).join('/');
    // Read first, write only what was read: an existence check before the read is a window in
    // which the record can vanish, and a missing record is one outcome, named, not a crash.
    const taskText = readTaskRecordText(path.resolve(root, taskRel));
    if (taskText === null) notes.push(`${taskRel} is not on disk — nothing re-pointed`);
    else if (taskText.includes(oldRel)) {
      writeFileSync(path.resolve(root, taskRel), taskText.split(oldRel).join(newRel));
      notes.push(`rewrote ${oldRel} → ${newRel} in ${taskRel}`);
    }
  }
  return { exit: 0, from: upgrade.from, to: upgrade.to, path: target, moved, notes };
}

// ── approve ──────────────────────────────────────────────────────────────────────────────────────

const LANE_SCAN = path.join(import.meta.dirname, 'scan-lane-declaration.mjs');

/** The registry rows' Evidence condition cells by class ID — the third column of the same table. */
export function registryConditions(section) {
  const conditions = new Map();
  for (const cells of tableRows(String(section).split('\n'))) {
    const id = (cells[0] ?? '').replace(/^`|`$/g, '').trim();
    if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) conditions.set(id, (cells[2] ?? '').trim());
  }
  return conditions;
}

/**
 * The base the changed set is measured against: the merge base with `HARNESS_BASE_REF` when set,
 * else with `origin/develop` — the resolution `run-all-scans` and `scan-lane-declaration` share.
 */
export function resolveBaseRef(root, env = process.env) {
  const candidates = [env.HARNESS_BASE_REF?.trim(), 'origin/develop'].filter(Boolean);
  for (const ref of candidates) {
    if (!git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) continue;
    const mergeBase = git(root, ['merge-base', 'HEAD', ref]);
    if (mergeBase.ok && mergeBase.stdout.trim()) return { ref, base: mergeBase.stdout.trim() };
  }
  throw new Error(
    `refused: no base ref resolves (tried ${candidates.join(', ')}) — set HARNESS_BASE_REF=<ref> (the parent branch, on a stacked branch) or fetch origin/develop`,
  );
}

/**
 * The branch's changed set against `base`: committed and working-tree changes to tracked paths
 * (`git diff <base>`), plus every untracked path with its whole content as an addition — the draft
 * spec and the new test are usually untracked when approval is sought, and a floor that cannot see
 * them is a floor the change can walk under.
 */
export function changedSetSince(root, base) {
  const names = git(root, ['diff', '--name-only', '--diff-filter=ACMRD', base, '--']);
  if (!names.ok) throw new Error(`refused: git diff --name-only failed: ${names.stderr.trim()}`);
  const diff = git(root, ['diff', '--no-color', '--no-ext-diff', base, '--']);
  if (!diff.ok) throw new Error(`refused: git diff failed: ${diff.stderr.trim()}`);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']);
  if (!untracked.ok) throw new Error(`refused: git ls-files failed: ${untracked.stderr.trim()}`);
  const split = (text) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const paths = [...new Set([...split(names.stdout), ...split(untracked.stdout)])].sort();
  let diffText = diff.stdout;
  for (const file of split(untracked.stdout)) {
    // `--no-index` exits 1 when the files differ, which for /dev/null vs a file is always.
    const added = git(root, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-index',
      '--',
      '/dev/null',
      file,
    ]);
    diffText += added.stdout;
  }
  return { paths, diffText };
}

/**
 * `LANE-L0-L1`'s condition, measured: `scan-lane-declaration` over the changed set with the spec's
 * `lane:` as the declaration, in the scan's offline form (`--changed` / `--diff-file` /
 * `--trailers-file`) so the working tree counts and no second git read happens inside the scan.
 * Returns the evidence line; throws the refusal when the condition is not met — including a changed
 * set of zero paths, where the scan's `::expected-empty::` pass is earned by nothing.
 */
export function measureLaneDeclaration({ root, doc, env = process.env }) {
  const lane = String(doc.fm.lane ?? '')
    .trim()
    .toUpperCase();
  if (!/^L[0-2]$/.test(lane))
    throw new Error(
      `refused: the spec declares no \`lane: L0|L1|L2\` in its frontmatter, so there is no lane to measure`,
    );
  if (lane === 'L2')
    throw new Error(
      'refused: the spec declares `lane: L2`; the class condition requires the declared lane to be L0 or L1',
    );
  const { ref, base } = resolveBaseRef(root, env);
  const { paths, diffText } = changedSetSince(root, base);
  if (paths.length === 0)
    throw new Error(
      `refused: the diff against ${ref} (merge base ${base.slice(0, 12)}) is empty — no committed or working-tree change, so \`scan-lane-declaration\` would examine zero paths, and a pass over nothing is not evidence that the condition is met. Make the change first; on a branch stacked on another feature branch set HARNESS_BASE_REF=<that branch>.`,
    );
  const scratch = mkdtempSync(path.join(tmpdir(), 'robota-gate-lane-'));
  let run;
  try {
    const diffFile = path.join(scratch, 'changes.diff');
    const trailersFile = path.join(scratch, 'trailers.txt');
    writeFileSync(diffFile, diffText);
    writeFileSync(trailersFile, `Lane: ${lane}\n`);
    run = spawnSync(
      process.execPath,
      [
        LANE_SCAN,
        '--root',
        root,
        '--changed',
        paths.join(','),
        '--diff-file',
        diffFile,
        '--trailers-file',
        trailersFile,
      ],
      { cwd: root, encoding: 'utf8', env: { ...env, HARNESS_PR_BODY_FILE: '' } },
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const lines = output.split('\n').map((line) => line.trim());
  const summary = lines.find((line) => /^lane-declaration summary:/.test(line)) ?? null;
  // The scan's own size declaration, read through the registry's extractor rather than by a local
  // copy of its marker — the marker belongs to run-all-scans.mjs, and a module that spells it out is
  // itself read as declaring a size (scan-measurement-provenance).
  const declared = extractExamined(output).find((entry) => Number.isFinite(entry.size));
  const examined = declared ? Number(declared.size) : -1;
  const command = `node scripts/harness/scan-lane-declaration.mjs --changed <${paths.length} path(s)> --diff-file <diff vs ${ref}> --trailers-file <Lane: ${lane}>`;
  if (run.status !== 0 || !summary || !/result=PASS/.test(summary)) {
    const refusals = lines.filter((line) => /^- /.test(line) || /^❌/.test(line));
    throw new Error(
      `refused: the class condition is not met — \`${command}\` → exit ${run.status ?? 'null'}${summary ? `, \`${summary}\`` : ''}${refusals.length ? `\n  ${refusals.join('\n  ')}` : ''}`,
    );
  }
  if (examined <= 0)
    throw new Error(
      `refused: \`scan-lane-declaration\` examined ${examined < 0 ? 'no countable' : '0'} path(s) — a pass over nothing is not evidence`,
    );
  const floor = lines.find((line) => /^✅ Lane /.test(line)) ?? '';
  return `\`${command}\` over ${examined} changed path(s) — committed and working-tree changes vs ${ref} (merge base ${base.slice(0, 12)}) → exit 0, \`${summary}\`${floor ? ` (${floor.replace(/^✅\s*/, '').replace(/\.$/, '')})` : ''}`;
}

/**
 * Measurements bound to a class's Evidence condition BY ITS WORDING, the way the criteria are bound:
 * the registry row owns the condition, this table owns how to measure it. A class whose wording binds
 * no measurement still needs `--evidence`, typed — the fail-closed side.
 */
const CLASS_MEASUREMENTS = [
  {
    id: 'lane-declaration',
    pattern: /`scan-lane-declaration`\s+exits\s+0/i,
    run: measureLaneDeclaration,
  },
];

/** The measurement a class's Evidence condition wording binds, or null — exported so a test can pin the live row. */
export function boundClassMeasurement(condition) {
  return CLASS_MEASUREMENTS.find((candidate) => candidate.pattern.test(condition ?? '')) ?? null;
}

function formLabels(section, form) {
  const labels = [...section.matchAll(/^\*\*([^*:]+):\*\*/gm)].map((match) => match[1].trim());
  return {
    ...form,
    given: labels.find((label) => /^given$/i.test(label)) ?? 'Given',
    condition:
      labels.find((label) => /evidence condition/i.test(label)) ?? 'Evidence condition met',
  };
}

export function runApprove(options) {
  const root = path.resolve(options.root ?? WORKSPACE_ROOT);
  if (!options.doc) throw new Error('approve needs --doc');
  const route = (options.route ?? '').toUpperCase();
  if (route !== 'DIRECT' && route !== 'CLASS')
    throw new Error('approve needs --route DIRECT|CLASS');
  if (!options.instruction || options.instruction.trim() === '')
    throw new Error('approve needs --instruction "<verbatim>"');
  const docPath = resolveFrom(root, options.doc, '');
  const doc = loadDocument(docPath);
  const date = today(options);
  const given = options.given ?? date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(given)) throw new Error('--given must be YYYY-MM-DD');

  const section = parseRegistrySection(
    requireFile(
      resolveFrom(root, options['backlog-rule'], DEFAULT_BACKLOG_RULE),
      'backlog-execution rule',
    ),
  );
  if (!section)
    throw new Error('backlog-execution.md states no `### Delegated Approval Classes` section');
  const form = parseEvidenceForm(section);
  if (!form) throw new Error('the approval evidence form names no route/instruction/class field');
  const registry = parseRegistry(section);
  if (!registry) throw new Error('backlog-execution.md carries no delegated-class registry table');
  const labels = formLabels(section, form);

  const fields = [`**${labels.route}:** \`${route}\``];
  let evidence = null;
  if (route === 'CLASS') {
    const classId = options.class;
    if (!classId) throw new Error('approve --route CLASS needs --class <ID>');
    const row = registry.get(classId);
    if (!row)
      throw new Error(
        `refused: class \`${classId}\` is not in the delegated-class registry (${registry.size} registered)`,
      );
    if (row.registered > given)
      throw new Error(
        `refused: class \`${classId}\` was registered ${row.registered}, after the ${given} instruction`,
      );
    const condition = registryConditions(section).get(classId) ?? '';
    const measurement = boundClassMeasurement(condition);
    if (measurement) {
      evidence = measurement.run({ root, doc, env: options.env ?? process.env });
      if (options.evidence) evidence += ` — note: ${options.evidence}`;
    } else if (!options.evidence) {
      throw new Error(
        `approve --route CLASS: class \`${classId}\`'s evidence condition ("${condition.slice(0, 80)}") is not one gate.mjs measures — pass --evidence "<the measurement, with its command and output>"`,
      );
    } else {
      evidence = options.evidence;
    }
    fields.push(`**${labels.classField}:** \`${classId}\``);
  }
  const quoted = `"${options.instruction.replace(/^"|"$/g, '')}"`;
  fields.push(`**${labels.instruction}:** ${quoted}`);
  fields.push(
    `**${labels.given}:** ${given}, ${route === 'DIRECT' ? 'this conversation' : (options.conversation ?? 'this conversation')}`,
  );
  if (route === 'CLASS') fields.push(`**${labels.condition}:** ${evidence}`);
  // What is being approved, recorded so the criterion can read it back (REVIEW UNCHANGED SINCE
  // APPROVAL in the header). The entry itself lives in the Evidence Log, outside the fingerprint.
  fields.push(`**${REVIEW_FINGERPRINT_LABEL}:** ${reviewFingerprint(doc.text).rendered}`);

  const current = doc.fm.status ?? '(absent)';
  const candidateLines = [
    `### [GATE-APPROVAL] — ✅ PASS | ${date}`,
    '',
    `**Status upgrade:** ${current} → approved`,
    ...fields,
  ];
  // APPROVE EARNS ITS VERDICT (header): the entry is judged, in memory, against the catalogue's
  // GATE-APPROVAL mechanical set before anything is written, and the heading written is the one
  // that set earned. The scan's own parsers read the candidate first: the entry must parse.
  const candidate = appendToEvidenceLog(doc.text, candidateLines);
  const verdict = standingVerdict(candidate);
  const parsed = verdict
    ? classifyApproval(verdict, { form, registry })
    : { problem: 'no standing GATE-APPROVAL entry found after writing one' };
  const judgedDoc = loadDocument(docPath, candidate);
  const catalogue = parseCatalogue(
    requireFile(resolveFrom(root, options.catalogue, DEFAULT_CATALOGUE), 'gate catalogue'),
  );
  const gate = resolveGate({ gate: 'GATE-APPROVAL' }, judgedDoc);
  const results = judgeCriteria(catalogue, gate, {
    doc: judgedDoc,
    gate,
    root,
    cache: {},
    backlogRule: resolveFrom(root, options['backlog-rule'], DEFAULT_BACKLOG_RULE),
    verifyCmds: [],
  });
  const mechanical = results.filter((result) => result.criterion.tag === 'mechanical');
  const notPassing = mechanical.filter((result) => result.verdict !== 'PASS');
  const failing = notPassing.filter((result) => result.verdict === 'FAIL').length;
  const undecidable = notPassing.length - failing;
  const parts = [`${mechanical.length - notPassing.length} PASS`];
  if (failing > 0 || undecidable === 0) parts.push(`${failing} FAIL`);
  if (undecidable > 0) parts.push(`${undecidable} PENDING-GUARDIAN`);
  const summary = `GATE-APPROVAL mechanical set: ${parts.join(', ')}`;

  let lines;
  let problem = parsed.problem ?? null;
  if (notPassing.length === 0 && !problem) {
    lines = [
      ...candidateLines,
      '',
      ...results
        .filter((result) => result.verdict === 'PASS' || result.verdict === 'N/A')
        .map((result) => `- ${result.label}: ${result.observed}`),
    ];
  } else {
    lines = [
      `### [GATE-APPROVAL] — ❌ FAIL | ${date}`,
      '',
      `**Status remains:** ${current}`,
      ...fields,
      '**Failed criteria:**',
      '',
      ...notPassing.flatMap((result) => [
        `- ${result.verdict === 'PENDING-GUARDIAN' ? 'PENDING-GUARDIAN — ' : ''}${result.label}: ${result.observed}`,
        `  **Required action:** ${result.action ?? 'make the criterion decidable, then re-run approve'}`,
      ]),
    ];
    problem = [
      problem,
      summary,
      ...notPassing.map((result) => `${result.label}: ${result.observed}`),
    ]
      .filter(Boolean)
      .join('\n  ');
  }
  writeFileSync(docPath, appendToEvidenceLog(doc.text, lines));
  return { exit: problem ? 1 : 0, lines, problem, route: parsed.route, summary };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage:',
  '  gate.mjs judge   --gate <GATE> --doc <spec> [--continuation|--correction] [--lane L1|L2] [--catalogue <p>] [--rule <p>] [--backlog-rule <p>] [--root <p>] [--date YYYY-MM-DD] [--verify-cmd "<cmd>"]... [--dry-run]',
  '  gate.mjs record  --doc <spec> --tc TC-NN (--command "<cmd>" --exit <n> --output-file <p> | --skip "<reason>") [--date YYYY-MM-DD]',
  '  gate.mjs advance --doc <spec> [--rule <p>] [--root <p>]',
  '  gate.mjs approve --doc <spec> --route DIRECT|CLASS --instruction "<verbatim>" [--class <ID>] [--given YYYY-MM-DD] [--date YYYY-MM-DD] [--evidence "<note>"] [--backlog-rule <p>] [--catalogue <p>] [--root <p>]',
  "dates default to the LOCAL calendar date; the document's `lane:` is authoritative (--lane may only equal it); L1 order: approve → judge --gate PLAN → advance → one planning commit; a stacked branch sets HARNESS_BASE_REF=<parent branch> for the measured diff",
].join('\n');

export function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`❌ ${error.message}\n${USAGE}`);
    return 1;
  }
  const { subcommand, options } = parsed;
  try {
    switch (subcommand) {
      case 'judge': {
        const result = runJudge(options);
        for (const line of result.lines) console.log(line);
        console.log(result.summary);
        if (result.entry)
          console.log(
            result.written
              ? `Evidence Log entry appended (${result.entry[0]})`
              : `dry run — entry not written:\n${result.entry.join('\n')}`,
          );
        else if (result.exit === EXIT_PENDING && result.approvePending > 0)
          console.log(
            `no entry written: ${result.approvePending} GATE-APPROVAL criteria are PENDING — run \`gate.mjs approve\` first, then judge again`,
          );
        else if (result.exit === EXIT_PENDING)
          console.log("no entry written: pending criteria are the guardian's to judge and record");
        return result.exit;
      }
      case 'record': {
        const result = runRecord(options);
        console.log(`recorded ${result.lines[0]}`);
        return result.exit;
      }
      case 'advance': {
        const result = runAdvance(options);
        console.log(
          `advanced ${result.from} → ${result.to}: ${result.path}${result.moved ? '' : ' (folder unchanged)'}${result.notes.length ? ` — ${result.notes.join('; ')}` : ''}`,
        );
        return result.exit;
      }
      case 'approve': {
        const result = runApprove(options);
        console.log(`wrote ${result.lines[0]}`);
        if (result.problem) console.error(`❌ ${result.problem}`);
        else
          console.log(
            `standing-delegation-evidence: route ${result.route} accepted; ${result.summary}`,
          );
        return result.exit;
      }
      default:
        console.error(`❌ unknown subcommand ${subcommand ?? '(none)'}\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
