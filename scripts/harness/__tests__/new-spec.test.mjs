/*
 * PROC-016 TC-06 — the scaffold passes its own gate.
 *
 * Every refusal has a fixture that goes RED and a control that stays GREEN; the control is the
 * same fixture with the missing thing supplied. The section list is not asserted from a copy: it
 * is parsed out of `backlog-writer/SKILL.md`'s fenced schema block, so a section the skill adds and
 * the template lacks fails here rather than at the next GATE-WRITE.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import { recordStub } from '../allocate-work-item-id.mjs';
import { findSpecDocFrontmatterFindings } from '../check-spec-doc-frontmatter.mjs';
import { parseFrontmatterBlock } from '../frontmatter.mjs';
import { stripHtmlComments } from '../gate.mjs';
import {
  DEFAULT_WAIVER,
  DRAFT_DIR,
  TEMPLATE_PATH,
  TYPES,
  main,
  parseArgs,
  readTaskRecord,
  slugify,
} from '../new-spec.mjs';
import { collectSpecResearchFindings } from '../scan-spec-research.mjs';
import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.join(WORKSPACE_ROOT, 'scripts/harness/new-spec.mjs');
const SKILL = path.join(WORKSPACE_ROOT, '.agents/skills/backlog-writer/SKILL.md');

/** The headings TC-06 requires, in the order the full schema states them. */
const REQUIRED_HEADINGS = [
  '## Problem',
  '## Prior Art Research',
  '## Architecture Review',
  '### Affected Scope',
  '### Alternatives Considered',
  '### Decision',
  '### Architecture Review Checklist',
  '## Fallback & Degradation Declaration',
  '## Solution',
  '## Affected Files',
  '## Completion Criteria',
  '## Test Plan',
  '## User Execution Test Scenarios',
  '## Tasks',
  '## Evidence Log',
];

/** A root with the three governed paths, the real template, and the Task records asked for. */
function rootWith({ tasks = [], template = true } = {}) {
  const root = makeTemp('robota-new-spec-');
  mkdirSync(path.join(root, '.agents/tasks'), { recursive: true });
  mkdirSync(path.join(root, DRAFT_DIR), { recursive: true });
  mkdirSync(path.join(root, '.agents/templates'), { recursive: true });
  if (template) {
    writeFileSync(
      path.join(root, TEMPLATE_PATH),
      readFileSync(path.join(WORKSPACE_ROOT, TEMPLATE_PATH), 'utf8'),
    );
  }
  for (const task of tasks) {
    const slug = slugify(task.title);
    const text =
      task.text ??
      recordStub({
        id: task.id,
        title: task.title,
        today: '2026-08-28',
        issue: task.issue ?? null,
      });
    writeFileSync(path.join(root, '.agents/tasks', `${task.id}-${slug}.md`), text);
  }
  return root;
}

const STUB_TASK = { id: 'PROC-999', title: 'a scaffold example', issue: 1 };

const RICH_TASK = {
  id: 'HARNESS-998',
  title: 'the allocator pads to four digits',
  issue: 7,
  text: `---
title: 'HARNESS-998: the allocator pads to four digits'
issue: https://github.com/woojubb/robota/issues/7
status: todo
created: 2026-08-28
priority: medium
urgency: soon
area: scripts/harness/allocate-work-item-id.mjs, scripts/harness/__tests__/allocate-work-item-id.test.mjs
depends_on: []
---

# HARNESS-998: the allocator pads to four digits

## Objective

\`node scripts/harness/allocate-work-item-id.mjs INFRA --dry-run\` prints \`INFRA-0130\` on a tree whose
widest record is three digits wide.

Second paragraph the scaffold must not lift.

## Plan

- [ ] TODO
`,
};

function run(root, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], {
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** In-process invocation with captured streams — the seam the CLI and this file share. */
function invoke(root, args) {
  let stdout = '';
  let stderr = '';
  const code = main([...args, '--root', root], {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  });
  return { code, stdout, stderr };
}

const L1_ARGS = ['PROC-999', '--type', 'RULE', '--issue', '1', '--lane', 'L1'];

const headingsOf = (text) =>
  text.split('\n').filter((line) => /^#{2,3}\s/.test(line) && !line.startsWith('### [GATE'));
const withoutComments = stripHtmlComments;
const criteriaCount = (text) => (text.match(/^- \[ \] TC-\d{2}:/gm) ?? []).length;
const testPlanRows = (text) => (text.match(/^\| TC-\d{2} +\|/gm) ?? []).length;

describe('the dry run is the document, and it is the full schema', () => {
  const root = rootWith({ tasks: [STUB_TASK] });
  const { code, stdout } = run(root, [...L1_ARGS, '--dry-run']);

  it('exits 0 and prints the document (the control every refusal below is measured against)', () => {
    expect(code).toBe(0);
    expect(stdout.startsWith('---\n')).toBe(true);
  });

  it('carries every required "## " / "### " heading, in order', () => {
    const found = headingsOf(stdout);
    expect(found).toEqual(REQUIRED_HEADINGS);
  });

  it('writes nothing', () => {
    expect(readdirSync(path.join(root, DRAFT_DIR))).toEqual([]);
  });

  it('has as many Test Plan rows as TC-N criteria, and three of each', () => {
    expect(criteriaCount(stdout)).toBe(3);
    expect(testPlanRows(stdout)).toBe(criteriaCount(stdout));
    expect(stdout).toMatch(/^- \[ \] TC-01: /m);
    expect(stdout).toMatch(/^- \[ \] TC-02: /m);
    expect(stdout).toMatch(/^- \[ \] TC-03: /m);
  });

  it('carries no TBD / TODO outside an HTML comment', () => {
    expect(withoutComments(stdout)).not.toMatch(/\b(TBD|TODO)\b/);
  });

  it('carries none of the phrases GATE-WRITE bans from a criterion', () => {
    expect(stdout).not.toMatch(/works correctly|no errors|displays correctly/i);
    expect(stdout).not.toMatch(/^- \[ \] TC-\d+:.*\bimplemented\b/m);
  });

  it('parses through the harness frontmatter reader: draft, the type, non-empty tags, the lane', () => {
    const fm = parseFrontmatterBlock(stdout);
    expect(fm.get('status')).toBe('draft');
    expect(fm.get('type')).toBe('RULE');
    expect(fm.get('tags')).toEqual(['proc']);
    expect(fm.get('lane')).toBe('L1');
  });

  it('names the pairing and the issue under the title, from the Task record', () => {
    expect(stdout).toContain('# PROC-999: a scaffold example');
    expect(stdout).toContain('Paired with `.agents/tasks/PROC-999-a-scaffold-example.md`.'); // allow-missing-artifact: fixture path inside the test's temporary root
    expect(stdout).toContain('[issue #1](https://github.com/woojubb/robota/issues/1)');
    expect(stdout).toContain('- [ ] `.agents/tasks/PROC-999-a-scaffold-example.md` — todo'); // allow-missing-artifact: fixture path inside the test's temporary root
  });

  it('ticks all four checklist items and the New-surface N/A line', () => {
    expect(stdout.match(/^- \[x\] /gm)).toHaveLength(5);
    // The only unticked boxes are the criteria and the Task entry, which GATE-IMPLEMENT ticks.
    expect(stdout).not.toMatch(/^- \[ \] (?!TC-|`)/m);
    expect(stdout).toContain('New-surface placement: **N/A**');
  });

  it('declares "None" under Fallback & Degradation and leaves the Evidence Log empty', () => {
    expect(stdout).toMatch(/## Fallback & Degradation Declaration\n\nNone\n/);
    expect(stdout.trimEnd().endsWith('## Evidence Log')).toBe(true);
  });

  it('is already prettier-formatted, so lint-staged has nothing to rewrite', async () => {
    const config = await prettier.resolveConfig(path.join(WORKSPACE_ROOT, 'x.md'));
    const formatted = await prettier.format(stdout, { ...config, filepath: 'x.md' });
    expect(formatted).toBe(stdout);
  });
});

describe('L1 pre-fills the sections a scaffold can honestly state', () => {
  it('waives Prior Art with the default reason, ticks Sibling scan N/A, and marks User Execution not applicable', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const { stdout } = run(root, [...L1_ARGS, '--dry-run']);
    expect(stdout).toContain(`Waived: ${DEFAULT_WAIVER}`);
    expect(stdout).toContain(`- [x] Sibling scan 완료 — N/A: ${DEFAULT_WAIVER}`);
    expect(stdout).toMatch(/## User Execution Test Scenarios\n\nNot applicable — /);
  });

  it('takes the reason from --waive', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const { stdout } = run(root, [...L1_ARGS, '--dry-run', '--waive', 'a one-token regex fix']);
    expect(stdout).toContain('Waived: a one-token regex fix');
    expect(stdout).toContain('Sibling scan 완료 — N/A: a one-token regex fix');
  });

  it('--user-surface turns the not-applicable entry into the scenario placeholder', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const { stdout } = run(root, [...L1_ARGS, '--dry-run', '--user-surface']);
    expect(stdout).not.toContain('Not applicable —');
    expect(stdout).toMatch(/## User Execution Test Scenarios\n\n<!-- One scenario/);
  });

  it('passes scan-spec-research as generated', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    expect(run(root, L1_ARGS).code).toBe(0);
    expect(collectSpecResearchFindings(root)).toEqual([]);
  });
});

describe('L2 keeps the obligations no scaffold can discharge', () => {
  const L2_ARGS = ['PROC-999', '--type', 'RULE', '--issue', '1', '--lane', 'L2'];

  it('leaves Prior Art and User Execution as comments, and scan-spec-research names the gap', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    expect(run(root, L2_ARGS).code).toBe(0);
    const text = readFileSync(path.join(root, DRAFT_DIR, 'PROC-999-a-scaffold-example.md'), 'utf8');
    // The comments name the `Waived:` form as the opt-out; the document itself must not use it.
    expect(withoutComments(text)).not.toContain('Waived:');
    expect(withoutComments(text)).not.toContain('Not applicable —');
    expect(withoutComments(text)).not.toMatch(/\b(TBD|TODO)\b/);
    expect(parseFrontmatterBlock(text).get('lane')).toBe('L2');
    // The honest outcome: an L2 draft owes research, and the scaffold does not pretend otherwise.
    expect(collectSpecResearchFindings(root)).toHaveLength(1);
  });

  it('--waive on L2 is the documented opt-out and clears the finding', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    expect(run(root, [...L2_ARGS, '--waive', 'the user waived it']).code).toBe(0);
    expect(collectSpecResearchFindings(root)).toEqual([]);
  });
});

describe('the Task record is the source', () => {
  it('strips the id prefix from the title LITERALLY when the id carries regex metacharacters', () => {
    // `PROC-1.0+` read as a pattern is `PROC-1<any>0+:` — it never matches its own literal prefix,
    // and an id with `(` or `|` would match the wrong one. The id is data, not a regex.
    const root = rootWith({ tasks: [{ id: 'PROC-1.0+', title: 'a literal id', issue: 1 }] });
    const record = readTaskRecord(root, 'PROC-1.0+');
    expect(record).not.toBeNull();
    expect(record.title).toBe('a literal id');
  });

  it('lifts the first Objective paragraph into Problem and the area into Affected Scope / Files', () => {
    const root = rootWith({ tasks: [RICH_TASK] });
    const { code, stdout } = run(root, [
      'HARNESS-998',
      '--type',
      'INFRA',
      '--issue',
      '7',
      '--lane',
      'L1',
      '--dry-run',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain(
      '## Problem\n\n`node scripts/harness/allocate-work-item-id.mjs INFRA --dry-run`',
    );
    expect(stdout).not.toContain('Second paragraph');
    expect(stdout.match(/^- `scripts\/harness\/allocate-work-item-id\.mjs`$/gm)).toHaveLength(2);
    expect(stdout).toContain('tags: [harness]');
  });

  it('falls back to the title as the Problem seed when the Objective is the allocator stub', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const { stdout } = run(root, [...L1_ARGS, '--dry-run']);
    expect(stdout).toContain('## Problem\n\na scaffold example.\n');
    expect(stdout).toMatch(/### Affected Scope\n\n<!-- every package/);
  });

  /**
   * The filename is the Task's basename, always: `scan-user-execution-plan-order` pairs the two by
   * basename, so a `--title` that renamed the file (as it once did) produced an unpaired spec.
   */
  it("--title sets the H1 only; the file keeps the Task's basename", () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const { code, stdout } = run(root, [...L1_ARGS, '--title', 'Another Title!']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(`${DRAFT_DIR}/PROC-999-a-scaffold-example.md`);
    const text = readFileSync(path.join(root, DRAFT_DIR, 'PROC-999-a-scaffold-example.md'), 'utf8');
    expect(text).toContain('# PROC-999: Another Title!');
    expect(existsSync(path.join(root, DRAFT_DIR, 'PROC-999-another-title.md'))).toBe(false);
  });

  it('INFRA-135 --title "…" --dry-run reports the target path with the Task\'s slug', () => {
    const root = rootWith({
      tasks: [
        {
          id: 'INFRA-135',
          title: 'loop-run open refuses a second open on the same loop',
          issue: 2406,
        },
      ],
    });
    const { code, stdout, stderr } = run(root, [
      'INFRA-135',
      '--type',
      'INFRA',
      '--issue',
      '2406',
      '--lane',
      'L1',
      '--title',
      'loop-run open closes the previous run',
      '--dry-run',
    ]);
    expect(code, stderr).toBe(0);
    expect(stderr.trim()).toBe(
      `new-spec: dry run — target ${DRAFT_DIR}/INFRA-135-loop-run-open-refuses-a-second-open-on-the-same-loop.md (not written)`,
    );
    expect(stdout).toContain('# INFRA-135: loop-run open closes the previous run');
    expect(stdout).toContain(
      'Paired with `.agents/tasks/INFRA-135-loop-run-open-refuses-a-second-open-on-the-same-loop.md`.', // allow-missing-artifact: fixture path inside the test's temporary root
    );
    expect(readdirSync(path.join(root, DRAFT_DIR))).toEqual([]);
  });

  it('--tags replaces the namespace default', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const { stdout } = run(root, [...L1_ARGS, '--dry-run', '--tags', 'harness, ci']);
    expect(parseFrontmatterBlock(stdout).get('tags')).toEqual(['harness', 'ci']);
  });
});

describe('refusals, each beside its control', () => {
  it('L0 is refused with exit 1 — L0 has no spec document', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const refused = run(root, ['PROC-999', '--type', 'RULE', '--issue', '1', '--lane', 'L0']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/refusing --lane L0/);
    expect(readdirSync(path.join(root, DRAFT_DIR))).toEqual([]);
    expect(run(root, L1_ARGS).code).toBe(0);
  });

  it('a missing Task record is refused with exit 1, even on --dry-run', () => {
    const root = rootWith({ tasks: [] });
    const refused = run(root, [...L1_ARGS, '--dry-run']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/no \.agents\/tasks\/PROC-999-\*\.md record/);
    expect(refused.stdout).toBe('');
    writeFileSync(
      path.join(root, '.agents/tasks/PROC-999-a-scaffold-example.md'),
      recordStub({ id: 'PROC-999', title: 'a scaffold example', today: '2026-08-28', issue: 1 }),
    );
    expect(run(root, [...L1_ARGS, '--dry-run']).code).toBe(0);
  });

  it('an existing draft is refused with exit 1 and left untouched', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    expect(run(root, L1_ARGS).code).toBe(0);
    const file = path.join(root, DRAFT_DIR, 'PROC-999-a-scaffold-example.md');
    writeFileSync(file, 'the author has started editing\n');
    const refused = run(root, [...L1_ARGS, '--title', 'a scaffold example']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/already exists/);
    expect(readFileSync(file, 'utf8')).toBe('the author has started editing\n');
  });

  it('an --issue that disagrees with the Task record is refused', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const refused = run(root, ['PROC-999', '--type', 'RULE', '--issue', '2', '--lane', 'L1']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/disagrees with .*names issue #1/);
  });

  it('an absent governed tree fails closed rather than scaffolding into nowhere', () => {
    const root = rootWith({ tasks: [STUB_TASK], template: false });
    const refused = run(root, [...L1_ARGS, '--dry-run']);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toMatch(/mini-spec-template\.md missing from/);
  });

  it('a usage error, including an unknown argument, exits 2', () => {
    const root = rootWith({ tasks: [STUB_TASK] });
    expect(run(root, [...L1_ARGS, '--bogus']).code).toBe(2);
    expect(run(root, ['PROC-999', '--type', 'NOPE', '--issue', '1', '--lane', 'L1']).code).toBe(2);
    expect(run(root, ['PROC-999', '--type', 'RULE', '--lane', 'L1']).code).toBe(2);
    expect(run(root, ['--type', 'RULE', '--issue', '1', '--lane', 'L1']).code).toBe(2);
    expect(parseArgs(['PROC-999', '--type', 'RULE', '--issue', '1', '--lane', 'L1']).ok).toBe(true);
  });
});

describe('the written file passes the frontmatter gate for every type', () => {
  it.each(TYPES)('%s', (type) => {
    const root = rootWith({ tasks: [STUB_TASK] });
    const { code } = invoke(root, ['PROC-999', '--type', type, '--issue', '1', '--lane', 'L1']);
    expect(code).toBe(0);
    const file = path.join(root, DRAFT_DIR, 'PROC-999-a-scaffold-example.md');
    expect(findSpecDocFrontmatterFindings(file)).toEqual({ blocking: [], warnings: [] });
  });
});

describe('the template mirrors the schema backlog-writer carries', () => {
  it('has every heading the fenced schema block lists, in the same order', () => {
    const skill = readFileSync(SKILL, 'utf8');
    const fence = /## Spec Document File Schema[\s\S]*?```markdown\n([\s\S]*?)```/.exec(skill);
    expect(
      fence,
      'backlog-writer/SKILL.md no longer carries a fenced markdown schema',
    ).not.toBeNull();
    const required = headingsOf(fence[1]);
    expect(required.length).toBeGreaterThanOrEqual(10);

    const template = readFileSync(path.join(WORKSPACE_ROOT, TEMPLATE_PATH), 'utf8');
    const present = headingsOf(template);
    const missing = required.filter((heading) => !present.includes(heading));
    expect(missing, `template lacks section(s) the skill requires: ${missing.join(', ')}`).toEqual(
      [],
    );

    const order = required.map((heading) => present.indexOf(heading));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('the skill checklist items are the template checklist items, ticked', () => {
    const skill = readFileSync(SKILL, 'utf8');
    const template = readFileSync(path.join(WORKSPACE_ROOT, TEMPLATE_PATH), 'utf8');
    const items = [...skill.matchAll(/^- \[ \] (.+?)(?: — .*)?$/gm)]
      .map((m) => m[1])
      .filter((item) => !item.startsWith('TC-') && !item.startsWith('`'));
    expect(items.length).toBe(4);
    for (const item of items) expect(template).toMatch(new RegExp(`^- \\[x\\] ${item}`, 'm'));
  });
});
