import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { recordStub } from '../allocate-work-item-id.mjs';
import { L1_NOT_REQUIRED, evidenceEntries, parseCatalogue, parsePriorGateMap } from '../gate.mjs';
import { TEMPLATE_PATH } from '../new-spec.mjs';
import { parseStatusFolderMapping } from '../scan-doc-folder-status-agreement.mjs';
import {
  classifyApproval,
  parseEvidenceForm,
  parseRegistry,
  parseRegistrySection,
  standingVerdict,
} from '../scan-standing-delegation-evidence.mjs';

const GATE_SCRIPT = fileURLToPath(new URL('../gate.mjs', import.meta.url));
const NEW_SPEC_SCRIPT = fileURLToPath(new URL('../new-spec.mjs', import.meta.url));
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const DATE = '2026-08-28';

/**
 * A catalogue that mirrors the real one's SHAPE — level-3 gate headings carrying the status upgrade,
 * checkbox criteria with a trailing tag, sub-bullets under a criterion, and the prior-gate table —
 * with every GATE-WRITE criterion `mechanical` so a conforming draft reaches PASS rather than the
 * guardian. The wording of each criterion is the real catalogue's, because that wording is what
 * `gate.mjs` binds a judgement to.
 */
const CATALOGUE = `# Gate Catalogue

## Evidence Log Entry Format

\`\`\`markdown
### [<GATE-NAME>] — ✅ PASS | <YYYY-MM-DD>
\`\`\`

## Prior-gate map

| This gate      | Prior gate that must show PASS | Expected input status / folder |
| -------------- | ------------------------------ | ------------------------------ |
| GATE-APPROVAL  | GATE-WRITE                     | \`review-ready\`               |
| GATE-IMPLEMENT | GATE-APPROVAL                  | \`approved\`                   |
| GATE-VERIFY    | GATE-IMPLEMENT                 | \`in-progress\`                |
| GATE-COMPLETE  | GATE-VERIFY                    | \`verifying\`                  |

## Gate Criteria

### GATE-WRITE \`draft → review-ready\`

**Frontmatter:**

- [ ] File begins with \`---\` YAML frontmatter block — \`mechanical\`
- [ ] \`status: draft\` present in frontmatter — \`mechanical\`
- [ ] \`type:\` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY — \`mechanical\`
- [ ] \`tags:\` field present in frontmatter (may be empty array \`[]\`) — \`mechanical\`

**Problem section:**

- [ ] Does not contain "TBD", "TODO", or vague single-sentence descriptions — \`mechanical\`

**Prior Art Research:**

- [ ] \`## Prior Art Research\` (or \`## Research\`) section present — \`mechanical\`
- [ ] Section is substantiated: cites ≥1 documentation source, OR explicitly states no comparable
      reference was found — \`mechanical\`
- [ ] OR an explicit \`Waived: <reason>\` line is present — a bare or missing section is FAIL — \`mechanical\`

**Architecture Review Checklist:**

- [ ] All 4 checklist items are \`[x]\` — \`mechanical\`
- [ ] Sibling scan item is \`[x]\` with either completion evidence or explicit \`N/A: <reason>\` — \`mechanical\`
- [ ] Alternatives Considered has at least 2 entries with pro/con for each — \`mechanical\`

**Completion Criteria:**

- [ ] Every item has a \`TC-N\` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL — \`mechanical\`
- [ ] No criterion uses: "works correctly", "no errors", "implemented", "displays correctly" — \`mechanical\`

**Test Plan section:**

- [ ] \`## Test Plan\` section present — \`mechanical\`
- [ ] One row exists for each TC-N in Completion Criteria (count must match) — \`mechanical\`
- [ ] Each row has a non-empty Test Type and Tool/Approach (no "TBD") — \`mechanical\`
- [ ] Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible — \`mechanical\`

**Structure:**

- [ ] Tasks section present with placeholder — \`mechanical\`
- [ ] Evidence Log section present and empty (first GATE-WRITE run) — \`mechanical\`
- [ ] No \`## Status\` or \`## Classification\` sections in the body (these are frontmatter fields) — \`mechanical\`

---

### GATE-APPROVAL \`review-ready → approved\`

- [ ] User has provided explicit approval in the current conversation — \`mechanical\`
- [ ] The named class exists in the delegated-class registry, and its registry entry predates this
      approval — \`mechanical\`
- [ ] The authorising instruction is recorded verbatim, with its date and the session it was given in — \`mechanical\`
- [ ] The class's stated evidence condition is shown to be met by measurement, not by assertion — \`mechanical\`
- [ ] No Architecture Review or frontmatter type/tags modified after approval — \`mechanical\`

---

### GATE-IMPLEMENT \`approved → in-progress\`

- [ ] \`.agents/tasks/<ID>.md\` has been created — \`mechanical\`
- [ ] Tasks file path is recorded in the \`## Tasks\` section of the spec document — \`mechanical\`
- [ ] Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N) — \`mechanical\`
- [ ] The tasks file includes a \`## Test Plan\` (or \`## Testing\` / \`## 검증\`) section with ≥50 chars — \`mechanical\`
- [ ] The exact Task records a subject-bound user-execution PLAN terminal outcome — \`mechanical\`
- [ ] The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the
      exact paired Task/spec planning artifacts and any subject-bound PLAN ledger record — \`mechanical\`

---

### GATE-VERIFY \`in-progress → verifying\`

- [ ] All tasks in \`.agents/tasks/<ID>.md\` are marked complete (\`[x]\`) — \`mechanical\`
- [ ] No tasks are blocked or pending — \`mechanical\`
- [ ] Build passes for all affected packages (\`pnpm build\`) — \`mechanical\`
- [ ] Tests pass for all affected packages (\`pnpm test\`) — \`mechanical\`

---

### GATE-COMPLETE \`verifying → done\`

For each TC-N in \`## Completion Criteria\`:

- [ ] The checkbox is checked (\`[x]\`) — \`mechanical\`
- [ ] A \`[GATE-COMPLETE: TC-N]\` Evidence Log entry exists with: — \`mechanical\`
  - The exact command or action used to verify
  - The actual output or result observed

For each TC-N in \`## Test Plan\`:

- [ ] **One of the following is recorded:** — \`mechanical\`
  - **Test written:** test file path + test function/describe name
  - **Test skipped:** explicit reason why automated test was not written
- [ ] No TC-N is silently unaddressed — every row must have either a test reference or a skip reason — \`mechanical\`

After all criteria:

- [ ] Spec document \`## Completion Criteria\` checkboxes are all \`[x]\` — \`mechanical\`
- [ ] \`## Test Plan\` updated with test references or skip reasons for all TC-N rows — \`mechanical\`
- [ ] The spec's \`## Tasks\` section names the exact active task path under \`.agents/tasks/\` — \`mechanical\`
- [ ] That active task exists and is completion-ready: all tasks are \`[x]\`, with no pending or blocked item — \`mechanical\`
`;

/** The same catalogue with ONE GATE-WRITE criterion left untagged. */
const CATALOGUE_UNTAGGED = CATALOGUE.replace(
  '- [ ] Tasks section present with placeholder — `mechanical`',
  '- [ ] Tasks section present with placeholder',
);

/**
 * The same catalogue with TWO GATE-WRITE criteria tagged `semantic`, worded as the real catalogue
 * words them — the shape whose verdict the lane decides: N/A under L1, the guardian's under L2.
 */
const SEMANTIC_CRITERIA = [
  'Contains a concrete symptom (specific command, output, or behavior that is wrong)',
  'At least 1 criterion per distinct feature or sub-item',
];
const CATALOGUE_SEMANTIC = CATALOGUE.replace(
  '**Problem section:**\n',
  `**Problem section:**\n\n- [ ] ${SEMANTIC_CRITERIA[0]} — \`semantic\``,
).replace(
  '**Completion Criteria:**\n',
  `**Completion Criteria:**\n\n- [ ] ${SEMANTIC_CRITERIA[1]} — \`semantic\``,
);

/** `spec-workflow.md` § Spec-Document Status and Lifecycle Folders, in the shape the scan parses. */
const RULE = `# Spec workflow

### Spec-Document Status and Lifecycle Folders

| \`status:\` (frontmatter) | Folder                        | Meaning |
| ----------------------- | ----------------------------- | ------- |
| \`draft\`                 | \`.agents/spec-docs/draft/\`    | Written |
| \`review-ready\`          | \`.agents/spec-docs/backlog/\`  | Passed  |
| \`approved\`              | \`.agents/spec-docs/todo/\`     | Passed  |
| \`in-progress\`           | \`.agents/spec-docs/active/\`   | Passed  |
| \`verifying\`             | \`.agents/spec-docs/active/\`   | Passed  |
| \`done\`                  | \`.agents/spec-docs/done/\`     | Passed  |
| \`rejected\`              | \`.agents/spec-docs/rejected/\` | Closed  |

### Something else

| \`bogus\` | \`.agents/spec-docs/nowhere/\` | not in scope |
`;

/** `backlog-execution.md` § Delegated Approval Classes, with one registered class. */
const BACKLOG_RULE = `# Backlog execution

### Delegated Approval Classes

**Registry.**

| Class ID     | Scope — what falls inside | Evidence condition | Authorising instruction (verbatim) | Registered |
| ------------ | ------------------------- | ------------------ | ---------------------------------- | ---------- |
| \`DOC-TYPO\` | one-line wording fixes    | diff ≤ 3 lines     | "typo fixes go straight through"   | 2026-08-20 |

**Evidence form.**

Route DIRECT:

\`\`\`markdown
**Approval route:** \`DIRECT\`
**Instruction (verbatim):** "<exactly what the user typed or selected>"
**Given:** YYYY-MM-DD, this conversation
\`\`\`

Route CLASS:

\`\`\`markdown
**Approval route:** \`CLASS\`
**Class:** \`<Class ID from the registry>\`
**Instruction (verbatim):** "<exactly what the user typed or selected>"
**Given:** YYYY-MM-DD, <the conversation it was given in>
**Evidence condition met:** <the measurement, with its command and output — not an assertion>
\`\`\`

## Recommendation Gate
`;

const SPEC_ID = 'PROC-999-fixture';
const TASK_REL = `.agents/tasks/${SPEC_ID}.md`;

function conformingSpec({ status = 'draft', folder = 'draft', ticked = false } = {}) {
  const box = ticked ? '[x]' : '[ ]';
  return `---
status: ${status}
type: RULE
tags: [harness]
lane: L1
---

# ${SPEC_ID}: a conforming fixture

## Problem

Running \`node scripts/harness/example.mjs\` on a draft prints a pass over nothing. It happens whenever
the governed directory is absent, which is the shape of every fresh worktree.

## Prior Art Research

Comparable products document this flow: https://example.com/docs/feature — both gate on approval.

## Architecture Review

### Alternatives Considered

1. **Fail closed on the absent tree.**
   - Pro: nothing can pass silently.
   - Con: a fresh worktree needs the tree before the scan runs.
2. **Skip with a printed reason.**
   - Pro: nothing blocks.
   - Con: the reason is easy to miss.

### Decision

Alternative 1. The trade-off that drove it: a blocked run is visible, a silent pass is not.

### Architecture Review Checklist

- [x] Affected packages listed
- [x] Sibling scan complete — N/A: no sibling scan reads this tree
- [x] At least 2 alternatives reviewed
- [x] Decision rationale documented

## Completion Criteria

- ${box} TC-01: \`node scripts/harness/example.mjs\` on a root without the tree → exits 1 naming the tree.
- ${box} TC-02: \`node scripts/harness/example.mjs\` on a root with the tree → exits 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                       | Notes |
| ----- | --------- | ------------------------------------- | ----- |
| TC-01 | Unit      | fixture without the tree              |       |
| TC-02 | Unit      | fixture with the tree                 |       |

## Tasks

- [ ] \`${TASK_REL}\` — bound at .agents/spec-docs/${folder}/${SPEC_ID}.md

## Evidence Log
`;
}

const TASK = `---
title: '${SPEC_ID}: fixture task'
status: todo
---

# ${SPEC_ID}: fixture task

## Bound spec document

.agents/spec-docs/draft/${SPEC_ID}.md

## Plan

- [x] TC-01: write the refusal fixture
- [x] TC-02: write the control fixture

## Test Plan

Two vitest cases: one root without the governed tree (red), one with it (green). Both in one file.

## User Execution Test Scenarios

**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\` — harness-only change.
`;

/**
 * A workspace with the governed files laid out where the script expects them, so every test reads
 * `--catalogue`, `--rule`, `--backlog-rule` from the fixture, never from the live tree.
 */
function makeWorkspace({
  catalogue = CATALOGUE,
  spec = conformingSpec(),
  folder = 'draft',
  task = TASK,
} = {}) {
  const root = makeTemp('robota-gate-');
  const write = (relative, text) => {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
    return full;
  };
  write('.agents/specs/gate-catalogue.md', catalogue);
  write('.agents/rules/spec-workflow.md', RULE);
  write('.agents/rules/backlog-execution.md', BACKLOG_RULE);
  const doc = write(`.agents/spec-docs/${folder}/${SPEC_ID}.md`, spec);
  if (task) write(TASK_REL, task);
  return { root, doc };
}

function run(root, args) {
  const result = spawnSync(process.execPath, [GATE_SCRIPT, ...args, '--root', root], {
    encoding: 'utf8',
    cwd: root,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function judge(root, doc, gate, extra = []) {
  return run(root, ['judge', '--gate', gate, '--doc', doc, '--date', DATE, ...extra]);
}

function approve(root, doc, extra = []) {
  return run(root, ['approve', '--doc', doc, '--date', DATE, '--given', DATE, ...extra]);
}

function gitInit(root) {
  const identity = {
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'f@x',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'f@x',
  };
  const git = (args, env = {}) =>
    spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...identity, ...env },
    });
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fixture']);
  return git;
}

describe('the live governed documents parse with the readers gate.mjs uses', () => {
  it('reads every spec-document gate section, its status upgrade, and the prior-gate map from the real catalogue', () => {
    const text = readFileSync(path.join(WORKSPACE_ROOT, '.agents/specs/gate-catalogue.md'), 'utf8');
    const catalogue = parseCatalogue(text);
    for (const gate of [
      'GATE-WRITE',
      'GATE-APPROVAL',
      'GATE-IMPLEMENT',
      'GATE-VERIFY',
      'GATE-COMPLETE',
    ]) {
      const section = catalogue.gates.get(gate);
      expect(section, `${gate} section`).toBeDefined();
      expect(section.criteria.length, `${gate} criteria`).toBeGreaterThanOrEqual(4);
      expect(section.upgrade, `${gate} upgrade`).not.toBeNull();
    }
    expect(parsePriorGateMap(text).get('GATE-APPROVAL')).toEqual({
      gate: 'GATE-WRITE',
      status: 'review-ready',
    });
  });

  it('reads the real status table and the real approval form the same way the fixtures do', () => {
    const real = parseStatusFolderMapping(
      readFileSync(path.join(WORKSPACE_ROOT, '.agents/rules/spec-workflow.md'), 'utf8'),
    );
    expect(real.get('review-ready')).toBe('backlog');
    expect(Object.fromEntries(parseStatusFolderMapping(RULE))).toEqual(Object.fromEntries(real));
    const section = parseRegistrySection(
      readFileSync(path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'), 'utf8'),
    );
    expect(parseEvidenceForm(section)).toEqual(
      parseEvidenceForm(parseRegistrySection(BACKLOG_RULE)),
    );
  });
});

describe('judge — GATE-WRITE', () => {
  it('passes a conforming L1 draft, appends the ✅ entry in the catalogue form, and exits 0 (TC-04)', () => {
    const { root, doc } = makeWorkspace();
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('20 criteria judged — 20 PASS, 0 FAIL, 0 PENDING-GUARDIAN');
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-WRITE] — ✅ PASS | ${DATE}`);
    expect(text).toContain('**Status upgrade:** draft → review-ready');
    const [entry] = evidenceEntries(text);
    const evidenceLines = entry.lines.filter((line) => line.startsWith('- '));
    expect(evidenceLines).toHaveLength(20);
    expect(evidenceLines.find((line) => line.includes('`TC-N` prefix'))).toContain(
      '2 criteria, all `TC-NN:` prefixed',
    );
  });

  it('fails a draft missing a TC-N prefix, names the criterion in the ❌ entry, and exits 1 (TC-04)', () => {
    const spec = conformingSpec().replace('- [ ] TC-02: `node', '- [ ] `node');
    const { root, doc } = makeWorkspace({ spec });
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status).toBe(1);
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-WRITE] — ❌ FAIL | ${DATE}`);
    expect(text).toContain('**Status remains:** draft');
    expect(text).toContain('**Failed criteria:**');
    expect(text).toMatch(
      /- GATE-WRITE — Every item has a `TC-N` prefix[^\n]*: 1 item\(s\) without a `TC-NN:` prefix/,
    );
    expect(text).toMatch(
      /- GATE-WRITE — One row exists for each TC-N[^\n]*: 2 rows vs 1 TC criteria/,
    );
    expect(text).toContain('**Required action:**');
    expect(text).not.toContain('✅ PASS');
  });

  it('reports an untagged criterion as PENDING-GUARDIAN, writes no entry, and exits 2', () => {
    const { root, doc } = makeWorkspace({ catalogue: CATALOGUE_UNTAGGED });
    const before = readFileSync(doc, 'utf8');
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(
      /PENDING-GUARDIAN\s+GATE-WRITE — Tasks section present with placeholder — untagged/,
    );
    expect(result.stdout).toContain('no entry written');
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  /**
   * The lane decides the semantic set's verdict (spec-workflow.md § Lanes: L1 is the MECHANICAL
   * criteria, judged by gate.mjs alone). Before this case existed the script composed the full
   * GATE-WRITE section under L1, so the real catalogue's 7 semantic criteria came back
   * PENDING-GUARDIAN and every conforming L1 draft exited 2 — the guardian dispatch the lane exists
   * to avoid. Both lanes are pinned here, with the same catalogue and the same document.
   */
  it('L1 conforming draft → exit 0, entry written, semantic lines say N/A for L1', () => {
    const { root, doc } = makeWorkspace({ catalogue: CATALOGUE_SEMANTIC });
    const result = judge(root, doc, 'GATE-WRITE', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      '22 criteria judged — 20 PASS, 2 N/A (lane L1), 0 FAIL, 0 PENDING-GUARDIAN',
    );
    expect(result.stdout).not.toContain('PENDING-GUARDIAN ');
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-WRITE] — ✅ PASS | ${DATE}`);
    const [entry] = evidenceEntries(text);
    const evidenceLines = entry.lines.filter((line) => line.startsWith('- '));
    expect(evidenceLines).toHaveLength(22);
    for (const criterion of SEMANTIC_CRITERIA) {
      expect(evidenceLines).toContain(`- GATE-WRITE — ${criterion}: ${L1_NOT_REQUIRED}`);
    }
    expect(L1_NOT_REQUIRED).toBe('N/A — not required for lane L1 (spec-workflow.md § Lanes)');
  });

  it('the same draft under --lane L2 leaves the semantic set PENDING-GUARDIAN, writes nothing, exits 2', () => {
    const { root, doc } = makeWorkspace({ catalogue: CATALOGUE_SEMANTIC });
    const before = readFileSync(doc, 'utf8');
    const result = judge(root, doc, 'GATE-WRITE', ['--lane', 'L2']);
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stdout).toContain('22 criteria judged — 20 PASS, 0 FAIL, 2 PENDING-GUARDIAN');
    for (const criterion of SEMANTIC_CRITERIA) {
      expect(result.stdout).toContain(
        `PENDING-GUARDIAN GATE-WRITE — ${criterion} — semantic criterion`,
      );
    }
    expect(result.stdout).not.toContain(L1_NOT_REQUIRED);
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it('under L1 a mechanical FAIL still wins over the N/A set — FAIL > PENDING > PASS holds per lane', () => {
    const spec = conformingSpec().replace('- [ ] TC-02: `node', '- [ ] `node');
    const { root, doc } = makeWorkspace({ catalogue: CATALOGUE_SEMANTIC, spec });
    const result = judge(root, doc, 'GATE-WRITE', ['--lane', 'L1']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('2 N/A (lane L1), 2 FAIL, 0 PENDING-GUARDIAN');
    expect(readFileSync(doc, 'utf8')).toContain(`### [GATE-WRITE] — ❌ FAIL | ${DATE}`);
  });

  it('a mechanical FAIL is written even when a criterion is pending — the guardian cannot pass a missing prefix', () => {
    const spec = conformingSpec().replace('- [ ] TC-02: `node', '- [ ] `node');
    const { root, doc } = makeWorkspace({ catalogue: CATALOGUE_UNTAGGED, spec });
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status).toBe(1);
    expect(readFileSync(doc, 'utf8')).toContain('❌ FAIL');
  });

  it('a banned phrase is a FAIL naming the TC and the phrase; --dry-run prints the entry and writes nothing', () => {
    const spec = conformingSpec().replace('→ exits 0.', '→ works correctly.');
    const { root, doc } = makeWorkspace({ spec });
    const before = readFileSync(doc, 'utf8');
    const result = judge(root, doc, 'GATE-WRITE', ['--dry-run']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('TC-02: "works correctly"');
    expect(result.stdout).toContain('dry run — entry not written');
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it('refuses a missing catalogue instead of passing over no criteria', () => {
    const { root, doc } = makeWorkspace();
    const result = judge(root, doc, 'GATE-WRITE', ['--catalogue', 'nowhere/gate-catalogue.md']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gate catalogue not found');
  });
});

describe('the scaffold passes its own gate against the LIVE catalogue (PROC-016 TC-06)', () => {
  /**
   * End to end, exactly as TC-06 states it: `new-spec.mjs … --lane L1 --dry-run` piped into a file,
   * then `gate.mjs judge --gate GATE-WRITE --doc <file> --lane L1 --dry-run` with no --root and no
   * --catalogue — the real `.agents/specs/gate-catalogue.md`, whose GATE-WRITE section carries the
   * semantic criteria the fixture catalogue above lacks. `new-spec.test.mjs` proves the scaffold's
   * shape; this proves the gate accepts it with no edits. The L2 judgement of the same file is the
   * control: the semantic set is the guardian's there, so exit 2 is the correct answer and the exit 0
   * above is the lane rule, not a catalogue with nothing semantic in it.
   */
  function scaffoldRoot() {
    const root = makeTemp('robota-tc06-');
    const write = (relative, text) => {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text);
      return full;
    };
    write(TEMPLATE_PATH, readFileSync(path.join(WORKSPACE_ROOT, TEMPLATE_PATH), 'utf8'));
    write(
      path.join('.agents/tasks', 'PROC-999-a-scaffold-example.md'),
      recordStub({ id: 'PROC-999', title: 'a scaffold example', today: DATE, issue: 1 }),
    );
    mkdirSync(path.join(root, '.agents/spec-docs/draft'), { recursive: true });
    return root;
  }

  function judgeLive(file, extra) {
    const result = spawnSync(
      process.execPath,
      [GATE_SCRIPT, 'judge', '--gate', 'GATE-WRITE', '--doc', file, ...extra, '--dry-run'],
      { encoding: 'utf8', cwd: WORKSPACE_ROOT },
    );
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('new-spec --lane L1 --dry-run → gate.mjs judge --gate GATE-WRITE --lane L1 → exit 0', () => {
    const root = scaffoldRoot();
    const scaffold = spawnSync(
      process.execPath,
      [
        NEW_SPEC_SCRIPT,
        'PROC-999',
        '--type',
        'RULE',
        '--issue',
        '1',
        '--lane',
        'L1',
        '--dry-run',
        '--root',
        root,
      ],
      { encoding: 'utf8' },
    );
    expect(scaffold.status, scaffold.stderr).toBe(0);
    const file = path.join(root, 'PROC-999-dry-run.md');
    writeFileSync(file, scaffold.stdout);

    const l1 = judgeLive(file, ['--lane', 'L1']);
    expect(l1.status, l1.stdout + l1.stderr).toBe(0);
    expect(l1.stdout).toMatch(
      /gate GATE-WRITE \(lane L1\): \d+ criteria judged — \d+ PASS, \d+ N\/A \(lane L1\), 0 FAIL, 0 PENDING-GUARDIAN/,
    );
    expect(l1.stdout).toContain(`dry run — entry not written:\n### [GATE-WRITE] — ✅ PASS |`);
    expect(l1.stdout).toContain(L1_NOT_REQUIRED);
    // The scaffold declares `lane: L1` itself, so the flag is not what made it pass.
    expect(judgeLive(file, []).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(scaffold.stdout);

    const l2 = judgeLive(file, ['--lane', 'L2']);
    expect(l2.status, l2.stdout + l2.stderr).toBe(2);
    expect(l2.stdout).toMatch(/0 FAIL, [1-9]\d* PENDING-GUARDIAN/);
  });
});

describe('advance', () => {
  it('moves draft/ → backlog/ per the fixture status table, rewrites status:, and re-points the paired Task', () => {
    const { root, doc } = makeWorkspace();
    expect(judge(root, doc, 'GATE-WRITE').status).toBe(0);
    const result = run(root, ['advance', '--doc', doc]);
    expect(result.status, result.stderr).toBe(0);
    const moved = path.join(root, `.agents/spec-docs/backlog/${SPEC_ID}.md`);
    expect(existsSync(doc)).toBe(false);
    expect(existsSync(moved)).toBe(true);
    const text = readFileSync(moved, 'utf8');
    expect(text.split('\n')[1]).toBe('status: review-ready');
    expect(readFileSync(path.join(root, TASK_REL), 'utf8')).toContain(
      `.agents/spec-docs/backlog/${SPEC_ID}.md`,
    );
    expect(result.stdout).toContain('advanced draft → review-ready');
  });

  it('refuses when the last entry is a FAIL and leaves the file where it is', () => {
    const spec = conformingSpec().replace('- [ ] TC-02: `node', '- [ ] `node');
    const { root, doc } = makeWorkspace({ spec });
    expect(judge(root, doc, 'GATE-WRITE').status).toBe(1);
    const before = readFileSync(doc, 'utf8');
    const result = run(root, ['advance', '--doc', doc]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused: the last Evidence Log entry is ❌ FAIL/);
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it('refuses a status the rule maps to no folder rather than inventing one', () => {
    const spec =
      conformingSpec() +
      `\n### [GATE-X] — ✅ PASS | ${DATE}\n\n**Status upgrade:** draft → limbo\n`;
    const { root, doc } = makeWorkspace({ spec });
    const result = run(root, ['advance', '--doc', doc]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('maps no folder for status `limbo`');
  });
});

describe('approve', () => {
  it('DIRECT writes the entry the standing-delegation parsers accept and exits 0 (TC-04)', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    const result = approve(root, doc, ['--route', 'DIRECT', '--instruction', '승인, 진행해']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('route DIRECT accepted');
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-APPROVAL] — ✅ PASS | ${DATE}`);
    expect(text).toContain('**Status upgrade:** review-ready → approved');
    expect(text).toContain('**Approval route:** `DIRECT`');
    expect(text).toContain('**Instruction (verbatim):** "승인, 진행해"');
    expect(text).toContain(`**Given:** ${DATE}, this conversation`);
    // The scan's own parsers, with the form read from the REAL rule, accept what was written.
    const section = parseRegistrySection(
      readFileSync(path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'), 'utf8'),
    );
    const verdict = classifyApproval(standingVerdict(text), {
      form: parseEvidenceForm(section),
      registry: parseRegistry(section),
    });
    expect(verdict).toEqual({ route: 'DIRECT' });
  });

  it('CLASS with an unregistered class refuses and writes nothing', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    const before = readFileSync(doc, 'utf8');
    const result = approve(root, doc, [
      '--route',
      'CLASS',
      '--class',
      'NOT-A-CLASS',
      '--instruction',
      'x',
      '--evidence',
      '`wc -l` → 2',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('class `NOT-A-CLASS` is not in the delegated-class registry');
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it('CLASS with a registered class dated before the instruction is accepted (control)', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    const result = approve(root, doc, [
      '--route',
      'CLASS',
      '--class',
      'DOC-TYPO',
      '--instruction',
      'typo fixes go straight through',
      '--evidence',
      '`git diff --numstat` → 1 line',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain('**Class:** `DOC-TYPO`');
    expect(text).toContain('**Evidence condition met:** `git diff --numstat` → 1 line');
  });

  it('CLASS with an instruction dated before the registration refuses', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    const result = run(root, [
      'approve',
      '--doc',
      doc,
      '--date',
      DATE,
      '--given',
      '2026-08-01',
      '--route',
      'CLASS',
      '--class',
      'DOC-TYPO',
      '--instruction',
      'x',
      '--evidence',
      '`n` = 1',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('registered 2026-08-20, after the 2026-08-01 instruction');
  });
});

describe('lane L1 — PLAN and DONE compose the catalogue sets', () => {
  it('PLAN judges the WRITE + APPROVAL mechanical sets and writes [GATE-PLAN] draft → approved', () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('25 criteria judged — 25 PASS, 0 FAIL, 0 PENDING-GUARDIAN');
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-PLAN] — ✅ PASS | ${DATE}`);
    expect(text).toContain('**Status upgrade:** draft → approved');
    expect(text).toMatch(
      /GATE-APPROVAL — No Architecture Review[^\n]*: every Architecture Review[^\n]*on or before the 2026-08-28 approval \(git blame\)/,
    );
    const advanced = run(root, ['advance', '--doc', doc]);
    expect(advanced.status, advanced.stderr).toBe(0);
    expect(existsSync(path.join(root, `.agents/spec-docs/todo/${SPEC_ID}.md`))).toBe(true);
  });

  it('PLAN without an approve entry fails on the approval criteria, not silently', () => {
    const { root, doc } = makeWorkspace();
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status).toBe(1);
    expect(readFileSync(doc, 'utf8')).toContain('no standing `[GATE-APPROVAL] — ✅ PASS` entry');
  });

  it('an Architecture Review line committed AFTER the approval date is a FAIL (git blame)', () => {
    const { root, doc } = makeWorkspace();
    const git = gitInit(root);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    writeFileSync(
      doc,
      readFileSync(doc, 'utf8').replace(
        'Alternative 1. The trade-off',
        'Alternative 2. The trade-off',
      ),
    );
    git(['commit', '-q', '-am', 'revise the decision'], {
      GIT_AUTHOR_DATE: '2026-09-15T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-09-15T12:00:00Z',
    });
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status).toBe(1);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /last changed on 2026-09-15, after the 2026-08-28 approval/,
    );
  });

  it('an uncommitted Architecture Review edit has no date to order, so the check is skipped with the reason printed', () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    writeFileSync(
      doc,
      readFileSync(doc, 'utf8').replace(
        'Alternative 1. The trade-off',
        'Alternative 2. The trade-off',
      ),
    );
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(
      /No Architecture Review[^\n]*skipped — 1 line\(s\) in the checked ranges are uncommitted/,
    );
  });

  it('DONE judges VERIFY + COMPLETE after record entries and writes [GATE-DONE] approved → done', () => {
    const spec =
      conformingSpec({ status: 'approved', folder: 'todo', ticked: true }).replace(
        '| fixture with the tree                 |       |',
        '| fixture with the tree                 | skipped: needs a live tree |',
      ) + `\n### [GATE-PLAN] — ✅ PASS | ${DATE}\n\n**Status upgrade:** draft → approved\n`;
    const { root, doc } = makeWorkspace({ spec, folder: 'todo' });
    const output = path.join(root, 'vitest.log');
    writeFileSync(output, 'RUN scripts/harness/__tests__/example.test.mjs\nTests 2 passed (2)\n');
    expect(
      run(root, [
        'record',
        '--doc',
        doc,
        '--tc',
        'TC-01',
        '--command',
        'pnpm exec vitest run scripts/harness/__tests__/example.test.mjs',
        '--exit',
        '0',
        '--output-file',
        output,
        '--date',
        DATE,
      ]).status,
    ).toBe(0);
    expect(
      run(root, [
        'record',
        '--doc',
        doc,
        '--tc',
        'TC-02',
        '--skip',
        'needs a live tree — verified by hand',
        '--date',
        DATE,
      ]).status,
    ).toBe(0);
    const result = judge(root, doc, 'DONE', [
      '--lane',
      'L1',
      '--verify-cmd',
      'echo build ok',
      '--verify-cmd',
      'echo tests ok',
    ]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-COMPLETE: TC-01] — ✅ PASS | ${DATE}`);
    expect(text).toContain(
      '**Command:** `pnpm exec vitest run scripts/harness/__tests__/example.test.mjs`',
    );
    expect(text).toContain('**Test skipped:** needs a live tree — verified by hand');
    expect(text).toContain(`### [GATE-DONE] — ✅ PASS | ${DATE}`);
    expect(text).toContain('**Status upgrade:** approved → done');
    expect(text).toContain('`echo build ok` → exit 0 (build ok)');
    const advanced = run(root, ['advance', '--doc', doc]);
    expect(advanced.status, advanced.stderr).toBe(0);
    expect(existsSync(path.join(root, `.agents/spec-docs/done/${SPEC_ID}.md`))).toBe(true);
  });

  it('DONE fails when a TC is unticked, a record is missing, or a verify command exits non-zero', () => {
    const spec =
      conformingSpec({ status: 'approved', folder: 'todo', ticked: true }).replace(
        '- [x] TC-02',
        '- [ ] TC-02',
      ) + `\n### [GATE-PLAN] — ✅ PASS | ${DATE}\n\n**Status upgrade:** draft → approved\n`;
    const { root, doc } = makeWorkspace({ spec, folder: 'todo' });
    const result = judge(root, doc, 'DONE', ['--lane', 'L1', '--verify-cmd', 'exit 3']);
    expect(result.status).toBe(1);
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-DONE] — ❌ FAIL | ${DATE}`);
    expect(text).toContain('TC-02 unticked');
    expect(text).toContain('no `[GATE-COMPLETE: TC-N]` entry for TC-01, TC-02');
    expect(text).toContain('`exit 3` → exit 3');
  });
});

describe('judge — GATE-IMPLEMENT reads the worktree', () => {
  function approvedWorkspace() {
    const spec =
      conformingSpec({ status: 'approved', folder: 'todo' }) +
      `\n### [GATE-WRITE] — ✅ PASS | ${DATE}\n\n**Status upgrade:** draft → review-ready\n\n### [GATE-APPROVAL] — ✅ PASS | ${DATE}\n\n**Status upgrade:** review-ready → approved\n**Approval route:** \`DIRECT\`\n**Instruction (verbatim):** "go"\n**Given:** ${DATE}, this conversation\n`;
    return makeWorkspace({ spec, folder: 'todo' });
  }

  it('passes when only the paired spec/Task and the PLAN ledger are dirty', () => {
    const { root, doc } = approvedWorkspace();
    gitInit(root);
    mkdirSync(path.join(root, '.agents/loop-runs'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/loop-runs/user-execution-scenario.jsonl'),
      '{"ref":"x"}\n',
    );
    writeFileSync(path.join(root, TASK_REL), TASK + '\nmore\n');
    const result = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(doc, 'utf8')).toContain('**Status upgrade:** approved → in-progress');
  });

  it('fails naming a path outside the paired artifacts', () => {
    const { root, doc } = approvedWorkspace();
    gitInit(root);
    writeFileSync(path.join(root, 'src-change.mjs'), 'export const early = true;\n');
    const result = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);
    expect(result.status).toBe(1);
    expect(readFileSync(doc, 'utf8')).toContain(
      '1 path(s) outside the paired spec/Task: src-change.mjs',
    );
  });

  it('fails when the Task named in ## Tasks does not exist', () => {
    const { root, doc } = approvedWorkspace();
    gitInit(root);
    spawnSync('git', ['rm', '-q', TASK_REL], { cwd: root });
    const result = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);
    expect(result.status).toBe(1);
    expect(readFileSync(doc, 'utf8')).toContain(`names ${TASK_REL}, which does not exist`);
  });
});
