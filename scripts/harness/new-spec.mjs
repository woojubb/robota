#!/usr/bin/env node

/**
 * Scaffold a spec document that passes GATE-WRITE's mechanical floor as generated (PROC-016, TC-06).
 *
 * ## The cost this removes
 *
 * PROC-016 measured one regex-token fix at 72 minutes of wall clock, 4 of them implementation. Three
 * of the seven guardian dispatches were GATE-WRITE re-runs, and every one of them failed on the
 * document's SHAPE — a missing `TC-N` prefix, a Test Plan row count that did not match, a checklist
 * box left `[ ]` — never on what the document said. The shape is fully mechanical, so a script writes
 * it and the author adds only the three things a scaffold cannot know: a paragraph of Problem, a line
 * of Decision, and the criteria.
 *
 * ## What it reads and why it refuses
 *
 * The paired Task record is the SOURCE, not a suggestion. `allocate-work-item-id.mjs` creates the
 * record first and it carries the title, the issue, the area and the objective; this script reads
 * them rather than asking again, so the spec and the Task cannot start life disagreeing. That is
 * also why a missing record is a refusal rather than a prompt for a title: a spec with no Task is
 * the orphan `.agents/tasks/README.md` forbids, and writing one here would manufacture it.
 *
 * It refuses, exit 1, when:
 *   - `--lane L0` — L0 has no spec document; the PR body carries the lane, the ground and the issue
 *     (spec-workflow.md § lanes).
 *   - no `.agents/tasks/<ID>-*.md` exists, or the ID is ambiguous across several records.
 *   - `--issue` names a different issue than the Task record's `issue:` field.
 *   - the draft file already exists — `wx`, one syscall, no check-then-write gap.
 * It exits 2 on a usage error, including an argument it does not know (HARNESS-095: an ignored
 * argument is a silent pass over the thing the caller asked for).
 *
 * ## The file is named after the Task, always
 *
 * The draft's basename IS the paired Task's basename: `scan-user-execution-plan-order` pairs a spec
 * with its Task by basename, so a spec named after a different slug is an unpaired spec. `--title`
 * therefore sets only the H1 text; it never changes the filename. `--dry-run` prints the document to
 * stdout and names the target path on stderr, so the pairing can be checked before anything is written.
 *
 * ## The lane decides the pre-fill
 *
 * L1 is "internal fix, no contract change" by construction, so its Prior Art is a `Waived:` line and
 * its User Execution section is the reasoned not-applicable entry `backlog-execution.md` requires —
 * both stated, never blank. L2 keeps the full schema's obligations and the scaffold leaves an HTML
 * comment where the author's research and scenarios go; those two sections are the ones no script
 * can write, and an L2 draft is expected to fail `scan-spec-research` until they are.
 *
 * Usage:
 *   node scripts/harness/new-spec.mjs <ID> --type <TYPE> --issue <N> --lane L1|L2
 *       [--title "<t>"] [--tags a,b] [--waive "<reason>"] [--user-surface|--no-user-surface]
 *       [--dry-run] [--root <dir>]
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { asList, asScalar, frontmatterObject } from './frontmatter.mjs';
import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

export const TASKS_DIR = '.agents/tasks';
export const DRAFT_DIR = '.agents/spec-docs/draft';
export const TEMPLATE_PATH = '.agents/templates/mini-spec-template.md';
export const ISSUE_URL_BASE = 'https://github.com/woojubb/robota/issues/';

/** The lanes that carry a spec document. L0 is refused by name, not by omission. */
export const SPEC_LANES = ['L1', 'L2'];

/** The 11 SDLC prefixes `backlog-writer` § Frontmatter enumerates; `check-spec-doc-frontmatter` refuses any other. */
export const TYPES = [
  'SCREEN',
  'API',
  'FLOW',
  'BEHAVIOR',
  'DATA',
  'RULE',
  'AGREEMENT',
  'INFRA',
  'PERF',
  'SECURITY',
  'OBSERVABILITY',
];

export const DEFAULT_WAIVER =
  "internal fix with no contract change; the remedy is the repository's own precedent";

export const DEFAULT_NOT_APPLICABLE =
  'no runnable user-facing behaviour changes; verification evidence is recorded in the engineering ' +
  'test plan (TC-01 to TC-03)';

const WORK_ITEM_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{3,}$/;
const VALUE_FLAGS = new Set([
  '--type',
  '--issue',
  '--lane',
  '--title',
  '--tags',
  '--waive',
  '--root',
]);
const BOOLEAN_FLAGS = new Set(['--dry-run', '--user-surface', '--no-user-surface']);

export const USAGE =
  'usage: new-spec.mjs <ID> --type <TYPE> --issue <N> --lane L1|L2 [--title "<t>"] [--tags a,b] ' +
  '[--waive "<reason>"] [--user-surface|--no-user-surface] [--dry-run] [--root <dir>]';

/**
 * Parse argv into options, or an error. Every unknown token is an error: the script that ignores an
 * argument passes silently over the one thing the caller asked it to change.
 */
export function parseArgs(argv) {
  const options = {
    id: undefined,
    type: undefined,
    issue: undefined,
    lane: undefined,
    title: undefined,
    tags: undefined,
    waive: undefined,
    userSurface: undefined,
    dryRun: false,
    root: WORKSPACE_ROOT,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: `${token} requires a value` };
      }
      options[token.slice(2)] = value;
      index += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '--dry-run') options.dryRun = true;
      else options.userSurface = token === '--user-surface';
      continue;
    }
    if (token.startsWith('--')) return { ok: false, error: `unknown argument ${token}` };
    positional.push(token);
  }
  if (positional.length !== 1) {
    return { ok: false, error: 'exactly one positional argument, the work-item ID, is required' };
  }
  options.id = positional[0];
  if (!WORK_ITEM_ID.test(options.id)) {
    return { ok: false, error: `"${options.id}" is not a work-item ID (e.g. PROC-016)` };
  }
  if (!options.type || !TYPES.includes(options.type)) {
    return { ok: false, error: `--type must be one of ${TYPES.join(', ')}` };
  }
  if (!options.issue || !/^\d+$/.test(options.issue)) {
    return { ok: false, error: '--issue must be an issue number' };
  }
  if (!options.lane || !/^L[0-9]$/.test(options.lane)) {
    return { ok: false, error: '--lane must be L1 or L2 (L0 has no spec document)' };
  }
  options.root = path.resolve(options.root);
  return { ok: true, options };
}

/**
 * The same slug `allocate-work-item-id.mjs` gives a Task record. The draft's name is not derived from
 * it — the Task's own basename is reused verbatim (see the header) — but the tests build Task records
 * with it, and it stays the one owner of the slug shape on this side.
 */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** First paragraph under a `## <heading>` section, or '' when the section is absent or a stub. */
function sectionParagraph(body, heading) {
  const match = new RegExp(`^##\\s+${heading}\\s*$`, 'm').exec(body);
  if (!match) return '';
  const rest = body.slice(match.index + match[0].length);
  const end = rest.search(/^#{1,3}\s/m);
  const section = (end === -1 ? rest : rest.slice(0, end)).trim();
  const paragraph = section.split(/\n\s*\n/)[0].trim();
  if (paragraph === '' || /^(TODO|TBD)\b/.test(paragraph)) return '';
  return paragraph;
}

/**
 * The paired Task record for `id`: `null` when none exists, a `{ambiguous}` marker when several do.
 *
 * Only the live half is read. A record in `completed/` is finished work, and a spec drafted against
 * it would be planning what already shipped.
 */
export function readTaskRecord(root, id) {
  const dir = path.join(root, TASKS_DIR);
  const matches = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name.startsWith(`${id}-`))
    .sort();
  if (matches.length === 0) return null;
  if (matches.length > 1) return { ambiguous: matches.map((name) => `${TASKS_DIR}/${name}`) };

  const file = `${TASKS_DIR}/${matches[0]}`;
  const text = readFileSync(path.join(root, file), 'utf8');
  const fm = frontmatterObject(text);
  const fmTitle = asScalar(fm.title).replace(new RegExp(`^${id}:\\s*`), '');
  const h1 = /^#\s+(.+)$/m.exec(text)?.[1]?.replace(new RegExp(`^${id}:\\s*`), '') ?? '';
  const issue = asScalar(fm.issue).match(/(\d+)\s*$/)?.[1];
  const area = asList(fm.area)
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !/^(TODO|TBD)$/i.test(entry));
  return {
    file,
    title: (fmTitle || h1).trim(),
    status: asScalar(fm.status) || 'todo',
    issue,
    area,
    objective: sectionParagraph(text, 'Objective'),
  };
}

/** A markdown table padded the way prettier pads it, so the generated file is already formatted. */
export function formatTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, column) =>
    Math.max(3, ...all.map((row) => [...row[column]].length)),
  );
  const line = (row) =>
    `| ${row.map((cell, column) => cell + ' '.repeat(widths[column] - [...cell].length)).join(' | ')} |`;
  const rule = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return [line(header), rule, ...rows.map(line)].join('\n');
}

const bullets = (items) => items.map((item) => `- \`${item}\``).join('\n');

/** Every `{{TOKEN}}` value for the template, decided by lane and by what the Task record carries. */
export function buildFields(options, task) {
  const l1 = options.lane === 'L1';
  const waiver = options.waive ?? DEFAULT_WAIVER;
  const userSurface = options.userSurface ?? !l1;
  const title = (options.title ?? task.title).trim();
  const tags = (options.tags ?? options.id.replace(/-\d+$/, '').toLowerCase())
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');

  const problemSeed = task.objective || `${title}.`;
  const problem =
    `${problemSeed}\n\n` +
    '<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.\n' +
    '     Replace the seed above if it does not name both. -->';

  const priorArt =
    l1 || options.waive !== undefined
      ? `Waived: ${waiver}`
      : '<!-- DEFAULT-ON (research.md). Comparable products / OSS / agent references from PRODUCT DOCS, the\n' +
        '     behaviour they share, the constraint that applies to Robota, and at least one http citation\n' +
        '     (or state that nothing comparable exists). Opt out only with a `Waived: <reason>` line. -->';

  const scope =
    task.area.length > 0
      ? bullets(task.area)
      : '<!-- every package, layer and file that changes — `packages/<name>` / `<file path>`, one per line -->';

  const alternatives = l1
    ? "1. Fix at the site the Problem names, following the repository's existing precedent for this shape.\n" +
      '   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.\n' +
      '   - Con: a local fix removes the instance, not the class; a recurrence is its own item.\n' +
      '2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.\n' +
      '   - Pro: removes the class rather than the instance.\n' +
      '   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.'
    : '1. <!-- one line: the first alternative -->\n' +
      '   - Pro: <!-- what it gains -->\n' +
      '   - Con: <!-- what it costs -->\n' +
      '2. <!-- one line: the second alternative -->\n' +
      '   - Pro: <!-- what it gains -->\n' +
      '   - Con: <!-- what it costs -->';

  const decision = l1
    ? '**Alternative 1.** <!-- one line: the trade-off that drove it -->'
    : '<!-- Which alternative, and the trade-off that drove it. For a contract-boundary or wide-blast-radius\n' +
      '     change, record the validation spec-workflow.md § "Validated Recommendation Before Approval"\n' +
      '     requires: reachability, capability preservation, and an adversarial pass. -->';

  const solution = l1
    ? "Apply the fix at the site the Problem names, following the repository's existing precedent for\n" +
      'this shape, and add the test TC-01 names so the symptom is refused mechanically from then on.'
    : '<!-- the steps, numbered, each naming the file it changes -->';

  const criteria = [
    '- [ ] TC-01: `pnpm exec vitest run <test file>` → exits 0, and exits 1 with the fix reverted\n' +
      '      <!-- name the test; the reverted run is the red-proof of the refusal -->',
    '- [ ] TC-02: `pnpm harness:scan` → exits 0',
    '- [ ] TC-03: `pnpm harness:test` → exits 0',
  ].join('\n');

  const testPlan = formatTable(
    ['TC-ID', 'Test Type', 'Tool / Approach', 'Notes'],
    [
      [
        'TC-01',
        'Unit',
        '`pnpm exec vitest run` on the named test',
        'RED with the fix reverted, GREEN with it',
      ],
      ['TC-02', 'Suite', '`pnpm harness:scan`', 'Regression'],
      ['TC-03', 'Suite', '`pnpm harness:test`', 'Regression'],
    ],
  );

  const userExecution = userSurface
    ? '<!-- One scenario per user-observable surface this change delivers: the exact command a user runs,\n' +
      '     the observable result, and the evidence file. A scenario exercises the implemented code path;\n' +
      '     reading a document to prove the document is well written is not one (backlog-execution.md). -->'
    : `Not applicable — ${DEFAULT_NOT_APPLICABLE}.\n\n` +
      "Recorded as the rule's required choice rather than skipped.";

  return {
    ID: options.id,
    TITLE: title,
    TYPE: options.type,
    TAGS: tags.join(', '),
    LANE: options.lane,
    TASK_PATH: task.file,
    TASK_STATUS: task.status,
    ISSUE: options.issue,
    ISSUE_URL: `${ISSUE_URL_BASE}${options.issue}`,
    PROBLEM: problem,
    PRIOR_ART: priorArt,
    AFFECTED_SCOPE: scope,
    ALTERNATIVES: alternatives,
    DECISION: decision,
    SIBLING_SCAN_REASON: waiver,
    SOLUTION: solution,
    AFFECTED_FILES: scope,
    COMPLETION_CRITERIA: criteria,
    TEST_PLAN: testPlan,
    USER_EXECUTION: userExecution,
  };
}

/**
 * Substitute every `{{TOKEN}}`; a token the fields do not cover is an error, never left in place.
 *
 * A token may be single-quoted in the template (`type: '{{TYPE}}'`): the frontmatter is YAML, and
 * prettier reformats a bare `{{TYPE}}` there as a flow mapping. The quotes are the template's, not
 * the document's, and go with the token.
 */
export function renderTemplate(template, fields) {
  const rendered = template.replace(/'?\{\{([A-Z_]+)\}\}'?/g, (_, token) => {
    if (!(token in fields)) throw new Error(`new-spec: template token {{${token}}} has no value`);
    return fields[token];
  });
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`;
}

/** Render the document for `options` against `root`; the exported seam the CLI and the tests share. */
export function renderSpec(options) {
  const { root, id } = options;
  requireGovernedTree(root, [TASKS_DIR, DRAFT_DIR, TEMPLATE_PATH], {
    scan: 'new-spec',
    why: 'The Task tree is the source, the draft folder is the target and the template is the shape; without any one of them there is nothing to scaffold.',
  });
  const task = readTaskRecord(root, id);
  if (task === null) {
    return {
      ok: false,
      error:
        `no ${TASKS_DIR}/${id}-*.md record. A spec document is paired with a Task and never precedes ` +
        'it; allocate the record first (allocate-work-item-id.mjs).',
    };
  }
  if (task.ambiguous) {
    return { ok: false, error: `${id} has several records: ${task.ambiguous.join(', ')}` };
  }
  if (task.issue !== undefined && task.issue !== options.issue) {
    return {
      ok: false,
      error: `--issue ${options.issue} disagrees with ${task.file}, which names issue #${task.issue}`,
    };
  }
  const fields = buildFields(options, task);
  const template = readFileSync(path.join(root, TEMPLATE_PATH), 'utf8');
  const document = renderTemplate(template, fields);
  // The Task's basename, verbatim: the pairing scan matches the two by basename, and `--title`
  // changes the H1 only.
  const file = `${DRAFT_DIR}/${path.basename(task.file)}`;
  return { ok: true, document, file };
}

export function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    io.stderr.write(`new-spec: ${parsed.error}\n${USAGE}\n`);
    return 2;
  }
  const { options } = parsed;
  if (!SPEC_LANES.includes(options.lane)) {
    io.stderr.write(
      `new-spec: refusing --lane ${options.lane}. Only ${SPEC_LANES.join(' and ')} carry a spec ` +
        'document; an L0 change records its lane, ground and issue in the PR body instead.\n',
    );
    return 1;
  }
  const result = renderSpec(options);
  if (!result.ok) {
    io.stderr.write(`new-spec: ${result.error}\n`);
    return 1;
  }
  if (options.dryRun) {
    io.stdout.write(result.document);
    io.stderr.write(`new-spec: dry run — target ${result.file} (not written)\n`);
    return 0;
  }
  try {
    // `wx` — create-or-fail in ONE syscall; an `existsSync` first is a check with a gap after it.
    writeFileSync(path.join(options.root, result.file), result.document, { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      io.stderr.write(`new-spec: ${result.file} already exists — refusing to overwrite a draft.\n`);
      return 1;
    }
    throw error;
  }
  io.stdout.write(`${result.file}\n`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
