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
 *           gate's mechanical set the same way, semantic criteria recorded N/A. The lane defaults to
 *           the document's `lane:` frontmatter, then to L2.
 *   record  --doc <spec> --tc TC-NN (--command "<cmd>" --exit <n> --output-file <path> | --skip "<reason>")
 *           Appends the per-criterion `### [GATE-COMPLETE: TC-NN]` entry GATE-COMPLETE requires.
 *   advance --doc <spec> [--rule <spec-workflow.md>] [--root <workspace>]
 *           Reads the last Evidence Log entry; refuses unless it is a PASS with a `**Status upgrade:**`
 *           line; moves the file to the folder the rule maps the next status to; rewrites `status:`
 *           and the paired Task's citation of the old path.
 *   approve --doc <spec> --route DIRECT|CLASS --instruction "<verbatim>" [--class <ID>]
 *           [--given YYYY-MM-DD] [--evidence "<measurement>"] [--backlog-rule <path>]
 *           Appends the GATE-APPROVAL entry in the form `backlog-execution.md` § Delegated Approval
 *           Classes specifies, then judges it with the standing-delegation parsers and exits with
 *           their verdict.
 *
 * Exit codes: judge 0 PASS / 1 FAIL / 2 PENDING-GUARDIAN; every other subcommand 0 done / 1 refused.
 * A missing catalogue, rule, document or section is a refusal (exit 1) with the reason printed — a
 * gate that cannot read its own criteria has judged nothing ("Silence is not success").
 */

import { spawnSync } from 'node:child_process';
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

import { splitFrontmatter } from './frontmatter.mjs';
import { parseStatusFolderMapping } from './scan-doc-folder-status-agreement.mjs';
import { collectSpecResearchFindings } from './scan-spec-research.mjs';
import {
  classifyApproval,
  parseEvidenceForm,
  parseRegistry,
  parseRegistrySection,
  standingVerdict,
} from './scan-standing-delegation-evidence.mjs';

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
    composes: ['GATE-WRITE', 'GATE-APPROVAL'],
    upgrade: ['draft', 'approved'],
    prior: null,
  },
  'GATE-DONE': {
    aliases: ['DONE', 'GATE-DONE'],
    composes: ['GATE-VERIFY', 'GATE-COMPLETE'],
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
    const flagOnly = key === 'dry-run';
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

function today(options) {
  if (options.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('--date must be YYYY-MM-DD');
    return options.date;
  }
  return new Date().toISOString().slice(0, 10);
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
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)[-*]\s+\[([ xX])\]\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const indent = match[1].length;
    const parts = [match[3]];
    let next = i + 1;
    for (; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() === '') break;
      const lead = /^(\s*)/.exec(line)[1].length;
      if (lead <= indent) break;
      parts.push(line.trim());
    }
    items.push({ checked: match[2] !== ' ', text: parts.join(' ').trim(), line: i, indent });
    i = next - 1;
  }
  return items;
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

/** The catalogue's prior-gate map: `| GATE-X | GATE-Y | \`status\` |` rows under "Prior-gate map". */
export function parsePriorGateMap(text) {
  const section = sectionBody(text, /^Prior-gate map$/i);
  const map = new Map();
  if (!section) return map;
  for (const cells of tableRows(section.body)) {
    const [gate, prior, status] = cells;
    const statusToken = /`([a-z-]+)`/.exec(status ?? '');
    if (/^GATE-[A-Z]+$/.test(gate ?? '') && /^GATE-[A-Z]+$/.test(prior ?? '')) {
      map.set(gate, { gate: prior, status: statusToken ? statusToken[1] : null });
    }
  }
  return map;
}

// ── Document reading ─────────────────────────────────────────────────────────────────────────────

function loadDocument(docPath) {
  const text = requireFile(docPath, 'spec document');
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
  const section = sectionBody(text, /^Completion Criteria$/i);
  if (!section) return null;
  return checkboxItems(section.body).filter((item) => item.indent === 0);
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
      run: ({ doc, criterion }) => {
        const expected = /`status:\s*([a-z-]+)`/.exec(criterion.text)[1];
        const actual = doc.fm.status;
        return actual === expected
          ? pass(`\`status: ${actual}\``)
          : fail(
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

function problemChecks() {
  return [
    {
      id: 'problem-no-placeholders',
      pattern: /"TBD".*"TODO"/i,
      run: ({ doc }) => {
        const section = sectionBody(doc.text, /^Problem$/i);
        if (!section) return fail('no `## Problem` section', 'add the Problem section');
        const body = section.body.join('\n');
        const placeholder = /\b(TBD|TODO)\b/.exec(body);
        if (placeholder)
          return fail(
            `\`## Problem\` contains "${placeholder[1]}"`,
            'replace the placeholder with the concrete problem',
          );
        const prose = body.trim();
        const sentences = prose.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
        if (prose.length < 80 || sentences.length < 2) {
          return fail(
            `\`## Problem\` is ${prose.length} chars / ${sentences.length} sentence(s) — a vague single-sentence description`,
            'describe the symptom and its reproduction condition',
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

/**
 * "No Architecture Review or frontmatter type/tags modified after approval" — judged from `git
 * blame` author dates over those lines when the file is tracked and the lines are committed; skipped
 * with the reason printed when git cannot say (an untracked file, a working-tree edit not yet
 * committed), because a date that does not exist cannot be compared.
 */
function architectureUnchangedSinceApproval(ctx) {
  const { verdict } = approvalContext(ctx);
  if (!verdict)
    return fail(
      'no standing GATE-APPROVAL entry to date the check from',
      'run `gate.mjs approve` first',
    );
  const approvedOn = /\|\s*(\d{4}-\d{2}-\d{2})/.exec(verdict)?.[1];
  const rel = path.relative(ctx.root, ctx.doc.path);
  const tracked = git(ctx.root, ['ls-files', '--error-unmatch', '--', rel]);
  if (!tracked.ok)
    return pass(
      `skipped — ${rel} is not tracked by git, so no line history exists to compare against ${approvedOn}`,
    );
  const lines = ctx.doc.text.split('\n');
  const ranges = [];
  const ar = lines.findIndex((line) => /^##\s+Architecture Review\s*$/i.test(line));
  if (ar !== -1) ranges.push([ar + 1, sectionEnd(lines, ar)]);
  lines.forEach((line, index) => {
    const key = line.startsWith(' ') ? '' : line.split(':')[0].trim();
    if (index < 40 && (key === 'type' || key === 'tags')) ranges.push([index + 1, index + 1]);
  });
  if (ranges.length === 0)
    return pass('skipped — no Architecture Review section or type/tags lines to blame');
  const blame = git(ctx.root, [
    'blame',
    '--line-porcelain',
    ...ranges.flatMap(([a, b]) => ['-L', `${a},${b}`]),
    '--',
    rel,
  ]);
  if (!blame.ok) return pass(`skipped — git blame failed: ${blame.stderr.trim().split('\n')[0]}`);
  const later = [];
  let uncommitted = 0;
  for (const block of blame.stdout.split(/\n(?=[0-9a-f]{40} )/)) {
    const hash = block.slice(0, 40);
    if (/^0{40}$/.test(hash)) {
      uncommitted += 1;
      continue;
    }
    const time = /^author-time (\d+)$/m.exec(block);
    if (!time) continue;
    const date = new Date(Number(time[1]) * 1000).toISOString().slice(0, 10);
    if (date > approvedOn) later.push(date);
  }
  if (later.length > 0)
    return fail(
      `${later.length} Architecture Review / type / tags line(s) last changed on ${[...new Set(later)].join(', ')}, after the ${approvedOn} approval`,
      're-run GATE-APPROVAL on the revised review',
    );
  if (uncommitted > 0)
    return pass(
      `skipped — ${uncommitted} line(s) in the checked ranges are uncommitted, so their date cannot be ordered against ${approvedOn}`,
    );
  return pass(
    `every Architecture Review / type / tags line dates on or before the ${approvedOn} approval (git blame)`,
  );
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
  if (task.text === null)
    return fail(`\`## Tasks\` names ${task.rel}, which does not exist`, 'create the Task file');
  return pass(`\`## Tasks\` names ${task.rel}, which exists`);
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
      run: taskExists,
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
        const signal = /SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(\d+)/.exec(
          task.text,
        );
        return signal
          ? pass(`Task records \`SCENARIO DRAFTED: ${signal[1]} | ${signal[2]}\``)
          : fail(
              'Task carries no `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>` line',
              'record the PLAN outcome in the Task',
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

function verifyCommandsPass(ctx) {
  const results = verifyCommands(ctx);
  if (results.length === 0)
    return fail(
      'no `--verify-cmd` supplied, so nothing was run',
      'pass the build/test command(s) via --verify-cmd',
    );
  const failed = results.filter((result) => result.exit !== 0);
  const summary = results
    .map(
      (result) =>
        `\`${result.command}\` → exit ${result.exit}${result.tail ? ` (${result.tail})` : ''}`,
    )
    .join('; ');
  return failed.length === 0 ? pass(summary) : fail(summary, 'make every verify command exit 0');
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
    { id: 'build-passes', pattern: /Build passes/i, run: verifyCommandsPass },
    { id: 'tests-pass', pattern: /Tests pass/i, run: verifyCommandsPass },
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

function resolveGate(options, doc) {
  const requested = options.gate;
  if (!requested) throw new Error('judge needs --gate');
  const lane = (options.lane ?? doc.fm.lane ?? 'L2').toUpperCase();
  if (lane === 'L1') {
    const composite = Object.entries(LANE_L1).find(([, spec]) => spec.aliases.includes(requested));
    if (composite)
      return {
        name: composite[0],
        composes: composite[1].composes,
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
  return { name: requested, composes: [requested], upgrade: null, prior: undefined, lane };
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
    for (const criterion of section.criteria) {
      const label = `${gateName} — ${criterion.text.replace(/\s+/g, ' ').slice(0, 110)}`;
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
        outcome = judgement.run({ ...ctx, criterion });
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
        verdict: outcome.ok ? 'PASS' : 'FAIL',
        observed: outcome.observed,
        action: outcome.action,
        id: judgement.id,
      });
    }
  }
  return results;
}

function orderingResult(catalogue, gate, doc) {
  const prior =
    gate.prior === undefined ? (catalogue.priorGates.get(gate.name) ?? null) : gate.prior;
  if (!prior) return null;
  const entries = (evidenceEntries(doc.text) ?? []).filter((entry) => entry.gate === prior.gate);
  const last = entries[entries.length - 1];
  const problems = [];
  if (!last || last.verdict !== '✅ PASS')
    problems.push(`last [${prior.gate}] entry is ${last ? last.verdict : 'absent'}, PASS required`);
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
 * without the route fields would retire the one that carries them.
 */
function mergeIntoLastApprovalEntry(text, lines) {
  const entries = evidenceEntries(text);
  const last = entries?.[entries.length - 1];
  if (!last || last.gate !== 'GATE-APPROVAL' || last.verdict !== '✅ PASS') return null;
  const docLines = text.split('\n');
  const start = docLines.findIndex((line) => /^##\s+Evidence Log\s*$/i.test(line));
  const end = sectionEnd(docLines, start);
  let cut = end;
  while (cut > start && docLines[cut - 1].trim() === '') cut -= 1;
  return [...docLines.slice(0, cut), ...lines, '', ...docLines.slice(end)]
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
  const pending = results.filter((result) => result.verdict === 'PENDING-GUARDIAN');
  const notRequired = results.filter((result) => result.verdict === 'N/A');
  // No examined-size declaration line: this is a command, not a registered scan, and a
  // self-reported size nothing reads is what `measurement-provenance` refuses. The count is part
  // of the summary instead. N/A is PASS-class for the verdict but counted apart, so the summary
  // says how many criteria the lane excused rather than folding them into what was judged.
  const passed = results.length - failed.length - pending.length - notRequired.length;
  const summary = `gate ${gate.name} (lane ${gate.lane}): ${results.length} criteria judged — ${passed} PASS, ${notRequired.length > 0 ? `${notRequired.length} N/A (lane ${gate.lane}), ` : ''}${failed.length} FAIL, ${pending.length} PENDING-GUARDIAN`;

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
  return { exit: verdict, lines, summary, entry, written, results, examined: results.length };
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

function rewriteFrontmatterStatus(text, next) {
  const lines = text.split('\n');
  const close = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  for (let i = 1; i < close; i += 1) {
    // Key comparison by prefix, not a `^status:` regex: `frontmatter.mjs` is the one owner of
    // frontmatter key regexes (HARNESS-046), and this is a rewrite, not a parse.
    if (lines[i].split(':')[0].trim() === 'status' && !lines[i].startsWith(' ')) {
      lines[i] = `status: ${next}`;
      return lines.join('\n');
    }
  }
  throw new Error('the frontmatter carries no `status:` line to rewrite');
}

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

  const specRoot = path.dirname(path.dirname(docPath));
  const target = path.join(specRoot, folder, path.basename(docPath));
  const moved = target !== docPath;
  const notes = [];
  writeFileSync(docPath, rewriteFrontmatterStatus(doc.text, upgrade.to));
  if (moved) {
    mkdirSync(path.dirname(target), { recursive: true });
    const mv = git(root, ['mv', path.relative(root, docPath), path.relative(root, target)]);
    if (mv.ok) notes.push('moved with git mv');
    else {
      renameSync(docPath, target);
      notes.push(
        `moved with rename (git mv refused: ${mv.stderr.trim().split('\n')[0] || 'not a git path'})`,
      );
    }
  }
  const taskRel = taskPathFromSpec(doc.text);
  const taskAbs = taskRel ? path.resolve(root, taskRel) : null;
  if (moved && taskAbs && existsSync(taskAbs)) {
    const oldRel = path.relative(root, docPath).split(path.sep).join('/');
    const newRel = path.relative(root, target).split(path.sep).join('/');
    const taskText = readFileSync(taskAbs, 'utf8');
    if (taskText.includes(oldRel)) {
      writeFileSync(taskAbs, taskText.split(oldRel).join(newRel));
      notes.push(`rewrote ${oldRel} → ${newRel} in ${taskRel}`);
    }
  }
  return { exit: 0, from: upgrade.from, to: upgrade.to, path: target, moved, notes };
}

// ── approve ──────────────────────────────────────────────────────────────────────────────────────

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
    if (!options.evidence)
      throw new Error(
        'approve --route CLASS needs --evidence "<the measurement that meets the class condition>"',
      );
    fields.push(`**${labels.classField}:** \`${classId}\``);
  }
  const quoted = `"${options.instruction.replace(/^"|"$/g, '')}"`;
  fields.push(`**${labels.instruction}:** ${quoted}`);
  fields.push(
    `**${labels.given}:** ${given}, ${route === 'DIRECT' ? 'this conversation' : (options.conversation ?? 'this conversation')}`,
  );
  if (route === 'CLASS') fields.push(`**${labels.condition}:** ${options.evidence}`);

  const current = doc.fm.status ?? '(absent)';
  const lines = [
    `### [GATE-APPROVAL] — ✅ PASS | ${date}`,
    '',
    `**Status upgrade:** ${current} → approved`,
    ...fields,
  ];
  const text = appendToEvidenceLog(doc.text, lines);
  writeFileSync(docPath, text);

  // The scan's own parsers, on this document: the entry just written is the standing verdict.
  const verdict = standingVerdict(text);
  const parsed = verdict
    ? classifyApproval(verdict, { form, registry })
    : { problem: 'no standing GATE-APPROVAL entry found after writing one' };
  return { exit: parsed.problem ? 1 : 0, lines, problem: parsed.problem, route: parsed.route };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage:',
  '  gate.mjs judge   --gate <GATE> --doc <spec> [--lane L1|L2] [--catalogue <p>] [--rule <p>] [--backlog-rule <p>] [--root <p>] [--date YYYY-MM-DD] [--verify-cmd "<cmd>"]... [--dry-run]',
  '  gate.mjs record  --doc <spec> --tc TC-NN (--command "<cmd>" --exit <n> --output-file <p> | --skip "<reason>")',
  '  gate.mjs advance --doc <spec> [--rule <p>] [--root <p>]',
  '  gate.mjs approve --doc <spec> --route DIRECT|CLASS --instruction "<verbatim>" [--class <ID>] [--given YYYY-MM-DD] [--evidence "<measurement>"] [--backlog-rule <p>]',
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
        if (result.problem) console.error(`❌ standing-delegation-evidence: ${result.problem}`);
        else console.log(`standing-delegation-evidence: route ${result.route} accepted`);
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
