import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { recordStub } from '../allocate-work-item-id.mjs';
import {
  formatCheckpointEvidence,
  parseCheckpointEvidence,
  parseCheckpointEvidenceContract,
  parseCheckpointEvidenceContracts,
  priorPassDigest,
  rawGateImplementPassEntries,
} from '../checkpoint-evidence-contract.mjs';
import {
  APPROVE_FIRST,
  L1_NOT_REQUIRED,
  boundClassMeasurement,
  evidenceEntries,
  localDate,
  parseCatalogue,
  parsePriorGateMap,
  registryConditions,
  reviewFingerprint,
  stripHtmlComments,
} from '../gate.mjs';
import { TEMPLATE_PATH } from '../new-spec.mjs';
import { parseStatusFolderMapping } from '../scan-doc-folder-status-agreement.mjs';
import {
  classifyApproval,
  parseEvidenceForm,
  parseRegistry,
  parseRegistrySection,
  standingVerdict,
} from '../scan-standing-delegation-evidence.mjs';
import { findHistoryFindings, findStagedFindings } from '../scan-user-execution-plan-order.mjs';

const GATE_SCRIPT = fileURLToPath(new URL('../gate.mjs', import.meta.url));
const NEW_SPEC_SCRIPT = fileURLToPath(new URL('../new-spec.mjs', import.meta.url));
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const DATE = '2026-08-28';
const LIVE_BACKLOG_RULE = readFileSync(
  path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
  'utf8',
);
const LIVE_CONTRACT_REGIONS = LIVE_BACKLOG_RULE.match(
  /<!-- user-execution-plan-contract:v1:start -->[\s\S]*?<!-- checkpoint-evidence-contract:v2:end -->/,
)?.[0];

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

#### Lane floors

| Floor | Path pattern                       | Why                          |
| ----- | ---------------------------------- | ---------------------------- |
| L2    | \`.agents/rules/spec-workflow.md\` | defines the lanes            |
| L2    | \`packages/*/src/**\`              | a package contract (fixture) |
| L1    | \`scripts/**\`                     | harness scripts              |
| L0    | everything else                    | the default                  |
`;

/** `backlog-execution.md` § Delegated Approval Classes, with one registered class. */
const BACKLOG_RULE = `# Backlog execution

### Delegated Approval Classes

**Registry.**

| Class ID     | Scope — what falls inside | Evidence condition | Authorising instruction (verbatim) | Registered |
| ------------ | ------------------------- | ------------------ | ---------------------------------- | ---------- |
| \`DOC-TYPO\` | one-line wording fixes    | diff ≤ 3 lines     | "typo fixes go straight through"   | 2026-08-20 |
| \`LANE-L0-L1\` | L0 and L1 items | \`scan-lane-declaration\` exits 0 on the branch and the declared lane is L0 or L1 | "approve every lane item" | 2026-08-20 |

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

function conformingSpec({
  status = 'draft',
  folder = 'draft',
  ticked = false,
  lane = 'L1',
  taskRel = TASK_REL,
} = {}) {
  const box = ticked ? '[x]' : '[ ]';
  return `---
status: ${status}
type: RULE
tags: [harness]
${lane === null ? '' : `lane: ${lane}\n`}---

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

**Delivery mode:** \`single\`

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

- [ ] \`${taskRel}\` — bound at .agents/spec-docs/${folder}/${SPEC_ID}.md

## Evidence Log
`;
}

/** The unedited `new-spec.mjs` Problem: a one-line seed plus the template's HTML comment. */
const SCAFFOLD_PROBLEM = `Fix the thing.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->`;

function withProblem(spec, problem) {
  return spec.replace(
    /## Problem\n\n[\s\S]*?(?=\n## Prior Art Research)/,
    `## Problem\n\n${problem}\n`,
  );
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

**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\`

**Reason:** This fixture changes repository lifecycle governance only and exposes no runnable Robota product surface for any user.
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
  backlogRule = `${BACKLOG_RULE}\n${LIVE_CONTRACT_REGIONS}`,
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
  write('.agents/rules/backlog-execution.md', backlogRule);
  const doc = write(`.agents/spec-docs/${folder}/${SPEC_ID}.md`, spec);
  if (task) write(TASK_REL, task);
  return { root, doc };
}

function run(root, args, env = {}) {
  const result = spawnSync(process.execPath, [GATE_SCRIPT, ...args, '--root', root], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function judge(root, doc, gate, extra = []) {
  return run(root, ['judge', '--gate', gate, '--doc', doc, '--date', DATE, ...extra]);
}

function approve(root, doc, extra = [], env = {}) {
  return run(root, ['approve', '--doc', doc, '--date', DATE, '--given', DATE, ...extra], env);
}

const CLASS_LANE = [
  '--route',
  'CLASS',
  '--class',
  'LANE-L0-L1',
  '--instruction',
  'approve every lane item',
];
/** The stacked-branch form: the base is named, not guessed — the fixture repo has no origin/develop. */
const BASE_HEAD = { HARNESS_BASE_REF: 'HEAD' };

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
    expect(parsePriorGateMap(text).get('GATE-IMPLEMENT (continuation)')).toEqual({
      gate: 'GATE-IMPLEMENT',
      status: 'in-progress',
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

  it("the live LANE-L0-L1 row's Evidence condition binds the scan-lane-declaration measurement", () => {
    const section = parseRegistrySection(
      readFileSync(path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'), 'utf8'),
    );
    const condition = registryConditions(section).get('LANE-L0-L1');
    expect(condition).toContain('`scan-lane-declaration` exits 0');
    expect(boundClassMeasurement(condition)?.id).toBe('lane-declaration');
    expect(
      boundClassMeasurement(registryConditions(parseRegistrySection(BACKLOG_RULE)).get('DOC-TYPO')),
    ).toBeNull();
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

  it('the same draft declared lane L2 leaves the semantic set PENDING-GUARDIAN, writes nothing, exits 2', () => {
    const { root, doc } = makeWorkspace({
      catalogue: CATALOGUE_SEMANTIC,
      spec: conformingSpec({ lane: 'L2' }),
    });
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

  /**
   * Round-A finding 6: a catalogue with no `## Prior-gate map` silently dropped every ordering
   * check (an empty map). The header promises refusal; now it refuses.
   */
  it('refuses a catalogue with no `## Prior-gate map` rather than judging with no ordering', () => {
    const catalogue = CATALOGUE.replace('## Prior-gate map', '## Some other table');
    const { root, doc } = makeWorkspace({ catalogue });
    const before = readFileSync(doc, 'utf8');
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the catalogue states no `## Prior-gate map` section');
    expect(readFileSync(doc, 'utf8')).toBe(before);
    expect(() => parsePriorGateMap(catalogue)).toThrow(/no `## Prior-gate map` section/);
  });

  /**
   * Round-A finding 2: HTML-comment text counted as Problem prose, so the unedited scaffold ("Fix the
   * thing." + the template's `<!-- … -->`) measured 171 chars / 4 sentences and passed. Comments are
   * stripped before measuring; the floor is ≥ 2 sentences OR ≥ 200 chars of real text — the shortest
   * genuine `done/` Problem (83 chars, 2 sentences) still passes it, a one-line seed does not.
   */
  it('an unedited scaffold Problem (one-line seed + HTML comment) is a FAIL naming the measurement', () => {
    const { root, doc } = makeWorkspace({ spec: withProblem(conformingSpec(), SCAFFOLD_PROBLEM) });
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /- GATE-WRITE — Does not contain "TBD"[^\n]*: `## Problem` is 14 chars \/ 1 sentence\(s\) after stripping HTML comments/,
    );
  });

  it('measures a Problem whose comment reassembles under a single strip as 0 chars — nothing survives', () => {
    // `<!-<!-- x -->->` minus its inner comment is `<!-->`: an opener a one-pass strip leaves behind
    // and then counts as prose. The floor measures what a renderer would show, which is nothing.
    const { root, doc } = makeWorkspace({ spec: withProblem(conformingSpec(), '<!-<!-- x -->->') });
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /`## Problem` is 0 chars \/ 0 sentence\(s\) after stripping HTML comments/,
    );
  });

  it('a Problem the size of the shortest genuine done/ spec (two short sentences) passes; one long sentence passes on length', () => {
    const shortest =
      'The spec cosmetic cleanup left three files with stray headings. They read as broken.';
    expect(shortest.length).toBeLessThan(100);
    const two = makeWorkspace({ spec: withProblem(conformingSpec(), shortest) });
    const twoResult = judge(two.root, two.doc, 'GATE-WRITE');
    expect(twoResult.status, twoResult.stdout + twoResult.stderr).toBe(0);
    expect(twoResult.stdout).toMatch(/`## Problem` has no TBD\/TODO; 8\d chars, 2 sentences/);
    const long = `Running the scan on a fresh worktree prints a pass over nothing because the governed directory is absent, ${'and the absence is the shape of every fresh clone, '.repeat(3)}which nobody notices`;
    expect(long.length).toBeGreaterThanOrEqual(200);
    const one = makeWorkspace({ spec: withProblem(conformingSpec(), long) });
    expect(judge(one.root, one.doc, 'GATE-WRITE').status).toBe(0);
  });

  /**
   * Round-A finding 5: `status: draft` was required on every GATE-WRITE run, so this branch's own
   * second GATE-WRITE on a `review-ready` document failed. A re-run accepts the prior GATE-WRITE
   * PASS's upgrade target as the status; without that prior PASS the criterion still fails.
   */
  it('a GATE-WRITE re-run on a review-ready document with a prior GATE-WRITE PASS accepts that status', () => {
    const spec =
      conformingSpec({ status: 'review-ready', folder: 'backlog' }) +
      `\n### [GATE-WRITE] — ✅ PASS | 2026-08-20\n\n**Status upgrade:** draft → review-ready\n\n- GATE-WRITE — File begins with \`---\` YAML frontmatter block: file begins with a \`---\` frontmatter block\n`;
    const { root, doc } = makeWorkspace({ spec, folder: 'backlog' });
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(
      /PASS\s+GATE-WRITE — `status: draft` present[^\n]*re-run: `status: review-ready` is the upgrade target of the prior \[GATE-WRITE\] PASS \(2026-08-20\)/,
    );
  });

  it('a review-ready document with NO prior GATE-WRITE PASS still fails the status criterion', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status).toBe(1);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /`status: draft` present[^\n]*: `status: review-ready`, required `status: draft`/,
    );
  });
});

/**
 * Round-A finding 1: `--lane` overrode the document's `lane:` DOWNWARD — an L2 document judged with
 * `--lane L1` passed with its semantic criteria N/A. The frontmatter is authoritative: `--lane` may
 * equal it, or set it when the document declares none; anything else is refused before judging.
 */
describe("the document's `lane:` is authoritative over --lane", () => {
  it('frontmatter L2 + --lane L1 is refused (exit 1), nothing judged, nothing written', () => {
    const { root, doc } = makeWorkspace({
      catalogue: CATALOGUE_SEMANTIC,
      spec: conformingSpec({ lane: 'L2' }),
    });
    const before = readFileSync(doc, 'utf8');
    const result = judge(root, doc, 'GATE-WRITE', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stderr).toContain(
      "refused: --lane L1 is below the document's `lane: L2` — the frontmatter lane is authoritative",
    );
    expect(result.stdout).not.toContain('criteria judged');
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it('frontmatter L1 + --lane L2 is refused too: --lane may only equal the declared lane', () => {
    const { root, doc } = makeWorkspace({ catalogue: CATALOGUE_SEMANTIC });
    const result = judge(root, doc, 'GATE-WRITE', ['--lane', 'L2']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "refused: --lane L2 does not equal the document's `lane: L1` — the frontmatter lane is authoritative",
    );
  });

  it('frontmatter L1 + --lane L1 is accepted (control)', () => {
    const { root, doc } = makeWorkspace({ catalogue: CATALOGUE_SEMANTIC });
    const result = judge(root, doc, 'GATE-WRITE', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('(lane L1)');
  });

  it('no `lane:` and no --lane is L2 behaviour: the semantic set is PENDING-GUARDIAN, exit 2', () => {
    const { root, doc } = makeWorkspace({
      catalogue: CATALOGUE_SEMANTIC,
      spec: conformingSpec({ lane: null }),
    });
    expect(readFileSync(doc, 'utf8')).not.toContain('lane:');
    const result = judge(root, doc, 'GATE-WRITE');
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stdout).toContain('gate GATE-WRITE (lane L2)');
    expect(result.stdout).toContain('2 PENDING-GUARDIAN');
  });

  it('no `lane:` + --lane L1 sets the lane (nothing to contradict)', () => {
    const { root, doc } = makeWorkspace({
      catalogue: CATALOGUE_SEMANTIC,
      spec: conformingSpec({ lane: null }),
    });
    const result = judge(root, doc, 'GATE-WRITE', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('2 N/A (lane L1)');
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
  /**
   * The Task's `## Objective` seeds the scaffold's `## Problem`. The record stub says `TODO` there,
   * which `new-spec` replaces with the one-line title — and a one-line Problem is what Round-A
   * finding 2 made a FAIL. So the objective is filled the way an author fills it before scaffolding;
   * the unedited stub is the RED case below.
   */
  const OBJECTIVE =
    'Running `node scripts/harness/new-spec.mjs` prints a scaffold whose Problem is one line. It happens on every fresh record, because the stub objective is a placeholder.';

  function scaffoldRoot({ objective = OBJECTIVE } = {}) {
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
      recordStub({ id: 'PROC-999', title: 'a scaffold example', today: DATE, issue: 1 }).replace(
        '## Objective\n\nTODO',
        `## Objective\n\n${objective}`,
      ),
    );
    mkdirSync(path.join(root, '.agents/spec-docs/draft'), { recursive: true });
    return root;
  }

  function scaffold(root) {
    const result = spawnSync(
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
    expect(result.status, result.stderr).toBe(0);
    const file = path.join(root, 'PROC-999-dry-run.md');
    writeFileSync(file, result.stdout);
    return { file, text: result.stdout };
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
    const { file, text } = scaffold(root);
    expect(text).toContain(OBJECTIVE);

    const l1 = judgeLive(file, ['--lane', 'L1']);
    expect(l1.status, l1.stdout + l1.stderr).toBe(0);
    expect(l1.stdout).toMatch(
      /gate GATE-WRITE \(lane L1\): \d+ criteria judged — \d+ PASS, \d+ N\/A \(lane L1\), 0 FAIL, 0 PENDING-GUARDIAN/,
    );
    expect(l1.stdout).toContain(`dry run — entry not written:\n### [GATE-WRITE] — ✅ PASS |`);
    expect(l1.stdout).toContain(L1_NOT_REQUIRED);
    // The scaffold declares `lane: L1` itself, so the flag is not what made it pass.
    expect(judgeLive(file, []).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(text);

    // The frontmatter lane is authoritative, so the L2 control is the same file declaring L2.
    const l2File = path.join(root, 'PROC-999-dry-run-l2.md');
    writeFileSync(l2File, text.replace('lane: L1', 'lane: L2'));
    const l2 = judgeLive(l2File, ['--lane', 'L2']);
    expect(l2.status, l2.stdout + l2.stderr).toBe(2);
    expect(l2.stdout).toMatch(/0 FAIL, [1-9]\d* PENDING-GUARDIAN/);
  });

  it('the UNEDITED scaffold — stub objective `TODO`, so a one-line Problem — fails GATE-WRITE on the Problem measurement', () => {
    const root = scaffoldRoot({ objective: 'TODO' });
    const { file, text } = scaffold(root);
    expect(text).toContain('## Problem\n\na scaffold example.\n\n<!--');
    const result = judgeLive(file, ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toMatch(
      /FAIL\s+GATE-WRITE — Does not contain "TBD"[^\n]*`## Problem` is 19 chars \/ 1 sentence\(s\) after stripping HTML comments/,
    );
  });
});

describe('stripHtmlComments', () => {
  it('strips a comment whose removal reassembles another (the single-pass hole CodeQL names)', () => {
    expect(stripHtmlComments('<!-<!-- a -->- b -->')).toBe('');
  });

  it('strips `<!-<!-- x -->->` to nothing', () => {
    expect(stripHtmlComments('<!-<!-- x -->->')).toBe('');
  });

  it('strips adjacent and ordinary comments and keeps the prose around them', () => {
    expect(stripHtmlComments('<!-- a --><!-- b -->')).toBe('');
    expect(stripHtmlComments('before <!-- a --> mid <!-- b --> after')).toBe('before  mid  after');
  });

  it('treats an opener with no closer as running to the end, the way a renderer does', () => {
    expect(stripHtmlComments('prose <!-- never closed')).toBe('prose ');
  });

  it('leaves text with no comment untouched, `-->` included', () => {
    expect(stripHtmlComments('a --> b')).toBe('a --> b');
  });
});

describe('advance', () => {
  it('still advances when the cited Task is not on disk, and says so instead of re-pointing nothing', () => {
    const { root, doc } = makeWorkspace();
    expect(judge(root, doc, 'GATE-WRITE').status).toBe(0);
    rmSync(path.join(root, TASK_REL));
    const result = run(root, ['advance', '--doc', doc]);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(root, `.agents/spec-docs/backlog/${SPEC_ID}.md`))).toBe(true);
    expect(result.stdout).toContain(`${TASK_REL} is not on disk — nothing re-pointed`);
  });

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

  it('moves an untracked draft with a plain rename and says so in one line, never "git mv refused"', () => {
    const { root } = makeWorkspace();
    gitInit(root);
    const draft = path.join(root, '.agents/spec-docs/draft/PROC-998-untracked.md');
    writeFileSync(draft, conformingSpec());
    expect(judge(root, draft, 'GATE-WRITE').status).toBe(0);
    const result = run(root, ['advance', '--doc', draft]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'moved with rename (.agents/spec-docs/draft/PROC-998-untracked.md is not tracked by git)',
    );
    expect(result.stdout).not.toContain('git mv refused');
    expect(existsSync(path.join(root, '.agents/spec-docs/backlog/PROC-998-untracked.md'))).toBe(
      true,
    );
  });

  it('moves a tracked draft with git mv (control)', () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    expect(judge(root, doc, 'GATE-WRITE').status).toBe(0);
    const result = run(root, ['advance', '--doc', doc]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('moved with git mv');
  });

  it('refuses an existing destination before mutating tracked or untracked source, destination, or Task', () => {
    for (const sourceKind of ['tracked', 'untracked']) {
      const { root, doc: trackedDoc } = makeWorkspace();
      gitInit(root);
      const doc =
        sourceKind === 'tracked'
          ? trackedDoc
          : path.join(root, '.agents/spec-docs/draft/PROC-998-untracked-collision.md');
      if (sourceKind === 'untracked') writeFileSync(doc, conformingSpec());
      expect(judge(root, doc, 'GATE-WRITE').status).toBe(0);
      const target = path.join(root, '.agents/spec-docs/backlog', path.basename(doc));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `existing destination: ${sourceKind}\n`);
      const sourceBefore = readFileSync(doc, 'utf8');
      const targetBefore = readFileSync(target, 'utf8');
      const taskPath = path.join(root, TASK_REL);
      const taskBefore = readFileSync(taskPath, 'utf8');

      const result = run(root, ['advance', '--doc', doc]);

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/refused: destination spec already exists/i);
      expect(readFileSync(doc, 'utf8')).toBe(sourceBefore);
      expect(readFileSync(target, 'utf8')).toBe(targetBefore);
      expect(readFileSync(taskPath, 'utf8')).toBe(taskBefore);
    }
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
      `\n### [GATE-X] — ✅ PASS | ${DATE}\n\n**Status upgrade:** draft → limbo\n\n- GATE-X — a criterion: judged\n`;
    const { root, doc } = makeWorkspace({ spec });
    const result = run(root, ['advance', '--doc', doc]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('maps no folder for status `limbo`');
  });

  /**
   * Round-A finding 4 (advance half): a bare `✅ PASS` heading plus a Status-upgrade line was enough
   * to advance, so approve → advance reached `approved` with no criterion ever judged. The last PASS
   * entry must carry at least one per-criterion result line that judge/approve produced.
   */
  it('refuses a PASS entry with a Status-upgrade line but no per-criterion result line', () => {
    const spec =
      conformingSpec() +
      `\n### [GATE-WRITE] — ✅ PASS | ${DATE}\n\n**Status upgrade:** draft → review-ready\n`;
    const { root, doc } = makeWorkspace({ spec });
    const before = readFileSync(doc, 'utf8');
    const result = run(root, ['advance', '--doc', doc]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'refused: the last entry [GATE-WRITE] carries no per-criterion result line (`- <GATE> — <criterion>: <observed>`) — a heading and a Status upgrade alone is not a judged gate',
    );
    expect(readFileSync(doc, 'utf8')).toBe(before);
    expect(existsSync(doc)).toBe(true);
  });
});

describe('approve', () => {
  it('DIRECT writes the entry the standing-delegation parsers accept, judges the mechanical set into it, and exits 0 (TC-04)', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    gitInit(root);
    const result = approve(root, doc, ['--route', 'DIRECT', '--instruction', '승인, 진행해']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('route DIRECT accepted');
    expect(result.stdout).toMatch(/GATE-APPROVAL mechanical set: 5 PASS, 0 FAIL/);
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-APPROVAL] — ✅ PASS | ${DATE}`);
    expect(text).toContain('**Status upgrade:** review-ready → approved');
    expect(text).toContain('**Approval route:** `DIRECT`');
    expect(text).toContain('**Instruction (verbatim):** "승인, 진행해"');
    expect(text).toContain(`**Given:** ${DATE}, this conversation`);
    // Round-A finding 4: the verdict is EARNED — the per-criterion lines are in the entry.
    const [entry] = evidenceEntries(text);
    const judged = entry.lines.filter((line) => /^- GATE-APPROVAL — .+: .+/.test(line));
    expect(judged).toHaveLength(5);
    expect(judged.find((line) => line.includes('explicit approval'))).toContain(
      'route DIRECT; `**Instruction (verbatim):**` recorded',
    );
    expect(judged.find((line) => line.includes('No Architecture Review'))).toContain(
      "equals the document's current fingerprint",
    );
    expect(text).toMatch(
      /\*\*Review fingerprint:\*\* [0-9a-f]{12} \(review [0-9a-f]{8}, type\/tags [0-9a-f]{8}\)/,
    );
    // And advance accepts it, because the lines are there.
    const advanced = run(root, ['advance', '--doc', doc]);
    expect(advanced.status, advanced.stderr).toBe(0);
    expect(existsSync(path.join(root, `.agents/spec-docs/todo/${SPEC_ID}.md`))).toBe(true);
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

  /**
   * Round-A finding 3, by fingerprint: `approve` records what it approved. An entry written by hand
   * (the guardian's, or a migrated one) carries no `**Review fingerprint:**` line, so the "not
   * modified after approval" criterion has nothing to compare against and is the guardian's to judge.
   */
  it('a GATE-APPROVAL entry without a Review fingerprint line leaves the review-unchanged criterion PENDING-GUARDIAN — exit 2, nothing written', () => {
    const { root, doc } = makeWorkspace({
      spec:
        conformingSpec({ status: 'review-ready', folder: 'backlog' }) +
        `\n### [GATE-WRITE] — ✅ PASS | ${DATE}\n\n**Status upgrade:** draft → review-ready\n\n- GATE-WRITE — a criterion: judged\n` +
        `\n### [GATE-APPROVAL] — ✅ PASS | ${DATE}\n\n**Status upgrade:** review-ready → approved\n**Approval route:** \`DIRECT\`\n**Instruction (verbatim):** "go"\n**Given:** ${DATE}, this conversation\n\n- GATE-APPROVAL — a criterion: judged by hand\n`,
      folder: 'backlog',
    });
    const before = readFileSync(doc, 'utf8');
    const result = judge(root, doc, 'GATE-APPROVAL', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stdout).toMatch(
      /PENDING-GUARDIAN GATE-APPROVAL — No Architecture Review[^\n]*carries no `\*\*Review fingerprint:\*\*` line/,
    );
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it('CLASS with a registered class dated before the instruction is accepted (control)', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    gitInit(root);
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

  it('CLASS on a class whose condition gate.mjs cannot measure still needs --evidence, and says why', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    const before = readFileSync(doc, 'utf8');
    const result = approve(root, doc, [
      '--route',
      'CLASS',
      '--class',
      'DOC-TYPO',
      '--instruction',
      'x',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'class `DOC-TYPO`\'s evidence condition ("diff ≤ 3 lines") is not one gate.mjs measures',
    );
    expect(readFileSync(doc, 'utf8')).toBe(before);
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

/**
 * `LANE-L0-L1`'s condition is MEASURED by running `scan-lane-declaration` over the branch's changed
 * set — committed and working-tree changes against the base — with the spec's `lane:`. The base is
 * `HARNESS_BASE_REF` (the fixture repo has no origin/develop, exactly like a stacked branch), and a
 * diff of zero paths is a refusal: the scan's `::expected-empty::` pass is earned by nothing.
 */
describe('approve --route CLASS --class LANE-L0-L1 measures the evidence', () => {
  it('runs scan-lane-declaration over the working-tree changed set and records its summary line as the evidence', () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    // Untracked, uncommitted: the change is in the working tree only, and the floor still sees it.
    mkdirSync(path.join(root, 'scripts/harness'), { recursive: true });
    writeFileSync(path.join(root, 'scripts/harness/x.mjs'), 'export const y = 1;\n');
    const result = approve(
      root,
      doc,
      [...CLASS_LANE, '--evidence', 'a note, not the evidence'],
      BASE_HEAD,
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('route CLASS accepted');
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain('**Class:** `LANE-L0-L1`');
    const condition = /^\*\*Evidence condition met:\*\*\s*(.+)$/m.exec(text)[1];
    expect(condition).toContain(
      '`node scripts/harness/scan-lane-declaration.mjs --changed <1 path(s)>',
    );
    expect(condition).toContain(
      'over 1 changed path(s) — committed and working-tree changes vs HEAD',
    );
    expect(condition).toContain('→ exit 0, `lane-declaration summary: violations=0 result=PASS`');
    expect(condition).toContain('Lane L1 (commit trailer) is at or above the floor L1');
    expect(condition).toMatch(/ — note: a note, not the evidence$/);
  });

  it('refuses an EMPTY changed set — a vacuous pass is not evidence — and writes nothing', () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    const before = readFileSync(doc, 'utf8');
    const result = approve(root, doc, CLASS_LANE, BASE_HEAD);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /refused: the diff against HEAD \(merge base [0-9a-f]{12}\) is empty/,
    );
    expect(result.stderr).toContain('a pass over nothing is not evidence');
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it("refuses when the diff's floor is above the declared lane, quoting the scan, and writes nothing", () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    mkdirSync(path.join(root, 'packages/core/src'), { recursive: true });
    writeFileSync(path.join(root, 'packages/core/src/index.ts'), 'export const contract = 1;\n');
    const before = readFileSync(doc, 'utf8');
    const result = approve(
      root,
      doc,
      [...CLASS_LANE, '--evidence', 'typed evidence cannot replace the measurement'],
      BASE_HEAD,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refused: the class condition is not met');
    expect(result.stderr).toContain('`lane-declaration summary: violations=1 result=FAIL`');
    expect(result.stderr).toContain(
      'declared L1 is below the floor L2 set by: packages/core/src/index.ts',
    );
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it('refuses with the HARNESS_BASE_REF hint when no base ref resolves (a stacked branch with no origin/develop)', () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    writeFileSync(path.join(root, 'scripts.txt'), 'x\n');
    const result = approve(root, doc, CLASS_LANE, { HARNESS_BASE_REF: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'refused: no base ref resolves (tried origin/develop) — set HARNESS_BASE_REF=<ref>',
    );
  });

  it('the measured evidence satisfies the GATE-APPROVAL "by measurement" criterion under PLAN', () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    mkdirSync(path.join(root, 'scripts/harness'), { recursive: true });
    writeFileSync(path.join(root, 'scripts/harness/x.mjs'), 'export const y = 1;\n');
    expect(approve(root, doc, CLASS_LANE, BASE_HEAD).status).toBe(0);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(
      /PASS\s+GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement[^\n]*route CLASS; evidence condition recorded as a measurement/,
    );
  });
});

/**
 * `today()` used `toISOString()`, which is UTC: an approval at 01:5x KST on the 28th was stamped the
 * 27th and refused against a row registered on the 28th. Every stamp is now the LOCAL calendar date.
 * Two zones 26 hours apart never share a calendar date, so the two runs below must differ whatever
 * the clock says — they could not under a UTC stamp.
 */
describe('dates are the local calendar date, overridable with --date on every stamping subcommand', () => {
  it('localDate formats the calendar date of the zone, not UTC', () => {
    const late = new Date('2026-08-27T16:55:00Z'); // 01:55 KST on the 28th
    expect(localDate(late, 'Asia/Seoul')).toBe('2026-08-28');
    expect(localDate(late, 'UTC')).toBe('2026-08-27');
    expect(localDate(late, 'Etc/GMT+12')).toBe('2026-08-27');
    expect(localDate(late, 'Etc/GMT-14')).toBe('2026-08-28');
  });

  function stampedApprovalDate(zone) {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog' }),
      folder: 'backlog',
    });
    gitInit(root);
    const before = localDate(new Date(), zone);
    const result = run(
      root,
      ['approve', '--doc', doc, '--route', 'DIRECT', '--instruction', 'go'],
      { TZ: zone },
    );
    const after = localDate(new Date(), zone);
    expect(result.status, result.stderr).toBe(0);
    const stamped = /### \[GATE-APPROVAL\] — ✅ PASS \| (\d{4}-\d{2}-\d{2})/.exec(
      readFileSync(doc, 'utf8'),
    )[1];
    expect([before, after]).toContain(stamped);
    expect(readFileSync(doc, 'utf8')).toContain(`**Given:** ${stamped}, this conversation`);
    return stamped;
  }

  it('approve without --date stamps the LOCAL date: UTC+14 and UTC-12 never agree', () => {
    const east = stampedApprovalDate('Etc/GMT-14');
    const west = stampedApprovalDate('Etc/GMT+12');
    expect(east).not.toBe(west);
  });

  it('--date overrides the stamp on approve, record and judge', () => {
    const { root, doc } = makeWorkspace({
      spec: conformingSpec({ status: 'review-ready', folder: 'backlog', lane: 'L2' }),
      folder: 'backlog',
    });
    gitInit(root);
    const approved = run(
      root,
      ['approve', '--doc', doc, '--route', 'DIRECT', '--instruction', 'go', '--date', '2026-01-02'],
      { TZ: 'Etc/GMT-14' },
    );
    expect(approved.status, approved.stderr).toBe(0);
    expect(readFileSync(doc, 'utf8')).toContain('### [GATE-APPROVAL] — ✅ PASS | 2026-01-02');
    const recorded = run(
      root,
      ['record', '--doc', doc, '--tc', 'TC-01', '--skip', 'by hand', '--date', '2026-01-03'],
      { TZ: 'Etc/GMT-14' },
    );
    expect(recorded.status, recorded.stderr).toBe(0);
    expect(readFileSync(doc, 'utf8')).toContain(
      '### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-01-03',
    );
    const judged = run(
      root,
      [
        'judge',
        '--gate',
        'GATE-APPROVAL',
        '--doc',
        doc,
        '--lane',
        'L2',
        '--date',
        '2026-01-04',
        '--dry-run',
      ],
      { TZ: 'Etc/GMT-14' },
    );
    expect(judged.stdout + judged.stderr).toContain('| 2026-01-04');
  });
});

describe('lane L1 — PLAN and DONE compose the catalogue sets', () => {
  /**
   * PLAN = GATE-WRITE's mechanical set + GATE-APPROVAL + the three Task-shaped GATE-IMPLEMENT
   * criteria (Task created, Task path recorded, PLAN outcome recorded) — never the worktree
   * inventory. The entry it writes carries the exact paired Task path token and the Task's own
   * `SCENARIO DRAFTED` line, which is what `scan-user-execution-plan-order` reads an L1 checkpoint
   * by (Round-A finding 8).
   */
  it('PLAN judges WRITE + APPROVAL + three IMPLEMENT criteria and writes [GATE-PLAN] draft → approved naming the Task path and its SCENARIO DRAFTED line', () => {
    const { root, doc } = makeWorkspace();
    gitInit(root);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('28 criteria judged — 28 PASS, 0 FAIL, 0 PENDING-GUARDIAN');
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-PLAN] — ✅ PASS | ${DATE}`);
    expect(text).toContain('**Status upgrade:** draft → approved');
    expect(text).toMatch(
      /GATE-APPROVAL — No Architecture Review[^\n]*: the `\*\*Review fingerprint:\*\*` recorded at approval \([0-9a-f]{12}\) equals the document's current fingerprint/,
    );
    const entry = evidenceEntries(text).find((candidate) => candidate.gate === 'GATE-PLAN');
    const body = entry.lines.join('\n');
    expect(body).toMatch(
      /^- GATE-IMPLEMENT — `\.agents\/tasks\/<ID>\.md` has been created: `## Tasks` names `\.agents\/tasks\/PROC-999-fixture\.md`, which exists$/m,
    );
    expect(body).toMatch(
      /^- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section[^\n]*: `## Tasks` names `\.agents\/tasks\/PROC-999-fixture\.md`, whose basename is the spec's$/m,
    );
    expect(body).toMatch(
      /^- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable \| 0`$/m,
    );
    expect(body).not.toMatch(/whole worktree/i);
    expect(body).not.toContain('Tasks in the file correspond');
    // The tokens in the exact bounded form the plan-order scan reads.
    expect(body).toMatch(/(^|[\s`])\.agents\/tasks\/PROC-999-fixture\.md(?=$|[\s`])/m);
    expect(body).toMatch(/SCENARIO DRAFTED:\s*not-applicable\s*\|\s*0(?!\d)/);
    const advanced = run(root, ['advance', '--doc', doc]);
    expect(advanced.status, advanced.stderr).toBe(0);
    expect(existsSync(path.join(root, `.agents/spec-docs/todo/${SPEC_ID}.md`))).toBe(true);
  });

  it('PLAN fails naming "`.agents/tasks/<ID>.md` has been created" when the Task file is missing', () => {
    const { root, doc } = makeWorkspace({ task: null });
    gitInit(root);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-PLAN] — ❌ FAIL | ${DATE}`);
    expect(text).toMatch(
      /- GATE-IMPLEMENT — `\.agents\/tasks\/<ID>\.md` has been created: `## Tasks` names `\.agents\/tasks\/PROC-999-fixture\.md`, which does not exist/,
    );
  });

  it("PLAN fails naming the Task-path criterion when the Task's basename differs from the spec's", () => {
    const other = '.agents/tasks/PROC-998-other.md';
    const { root, doc } = makeWorkspace({ spec: conformingSpec({ taskRel: other }) });
    writeFileSync(path.join(root, other), TASK);
    gitInit(root);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section[^\n]*: `## Tasks` names `\.agents\/tasks\/PROC-998-other\.md`, whose basename is not the spec's \(PROC-999-fixture\.md\)/,
    );
  });

  it('PLAN fails naming the PLAN-outcome criterion when the Task lacks the `**Author verdict:**` SCENARIO DRAFTED line', () => {
    const task = TASK.replace(
      '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
      'Scenarios: SCENARIO DRAFTED: not-applicable | 0 (asserted in prose, no author verdict line).',
    );
    expect(task).not.toContain('**Author verdict:**');
    const { root, doc } = makeWorkspace({ task });
    gitInit(root);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: Task `## User Execution Test Scenarios` carries no `\*\*Author verdict:\*\* `SCENARIO DRAFTED: \(not-applicable\|automatable\|manual\) \| <n>`` line \(0 found, exactly 1 required\)/,
    );
  });

  /**
   * PLAN composes GATE-APPROVAL, whose criteria read the entry `approve` writes. Before this case
   * existed, `judge --gate PLAN` before `approve` wrote a ❌ entry with 5 APPROVAL fails for a step
   * that had simply not run yet. The order is approve → judge; out of order is PENDING, not FAIL.
   */
  it('PLAN before approve reports the 5 GATE-APPROVAL criteria PENDING — run approve first — writes nothing, exits 2', () => {
    const { root, doc } = makeWorkspace();
    const before = readFileSync(doc, 'utf8');
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stdout).toContain(
      '28 criteria judged — 23 PASS, 0 FAIL, 0 PENDING-GUARDIAN, 5 PENDING-APPROVE',
    );
    expect(result.stdout.match(/^PENDING-APPROVE\s+GATE-APPROVAL — /gm)).toHaveLength(5);
    expect(result.stdout).toContain(APPROVE_FIRST);
    expect(result.stdout).toContain(
      'no entry written: 5 GATE-APPROVAL criteria are PENDING — run `gate.mjs approve` first, then judge again',
    );
    expect(readFileSync(doc, 'utf8')).toBe(before);
  });

  it('PLAN before approve still writes a ❌ entry for a mechanical GATE-WRITE FAIL — without approval lines in it', () => {
    const spec = conformingSpec().replace('- [ ] TC-02: `node', '- [ ] `node');
    const { root, doc } = makeWorkspace({ spec });
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status).toBe(1);
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-PLAN] — ❌ FAIL | ${DATE}`);
    expect(text).not.toContain('GATE-APPROVAL —');
  });

  /**
   * Round-A finding 3: "No Architecture Review or frontmatter type/tags modified after approval" was
   * decided by comparing CALENDAR DATES from git blame, so a same-day edit passed, and an uncommitted
   * edit was "skipped" as PASS. It is now decided by ANCESTRY: the commit that introduced the
   * GATE-APPROVAL PASS heading is found (`git log -S`, first-parent), and the review section and the
   * type/tags lines are compared between that commit and HEAD; any difference is a FAIL naming the
   * commits. An uncommitted change to those ranges is PENDING-GUARDIAN, never a pass.
   */
  function reviseDecision(doc) {
    writeFileSync(
      doc,
      readFileSync(doc, 'utf8').replace(
        'Alternative 1. The trade-off',
        'Alternative 2. The trade-off',
      ),
    );
  }

  it('an Architecture Review edit AFTER approval is a FAIL naming the section — no git, no dates', () => {
    const { root, doc } = makeWorkspace();
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    reviseDecision(doc);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /No Architecture Review[^\n]*: the Architecture Review section changed since the approval \([0-9a-f]{8} → [0-9a-f]{8}\)/,
    );
  });

  it('a type: change after approval is a FAIL naming the frontmatter half', () => {
    const { root, doc } = makeWorkspace();
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    writeFileSync(doc, readFileSync(doc, 'utf8').replace('type: RULE', 'type: INFRA'));
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /No Architecture Review[^\n]*: the frontmatter type\/tags lines changed since the approval \([0-9a-f]{8} → [0-9a-f]{8}\)/,
    );
  });

  it('an Architecture Review edit BEFORE approval is a PASS — the fingerprint records the revised review', () => {
    const { root, doc } = makeWorkspace();
    reviseDecision(doc);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /No Architecture Review[^\n]*: the `\*\*Review fingerprint:\*\*` recorded at approval \([0-9a-f]{12}\) equals the document's current fingerprint/,
    );
  });

  it('an untracked draft is approved and judged the same way — the fingerprint needs no history', () => {
    const { root, doc } = makeWorkspace();
    expect(existsSync(path.join(root, '.git'))).toBe(false);
    expect(approve(root, doc, ['--route', 'DIRECT', '--instruction', 'go']).status).toBe(0);
    const result = judge(root, doc, 'PLAN', ['--lane', 'L1']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
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
      'echo node scripts/harness/run-all-scans.mjs --affected',
      '--verify-cmd',
      'echo pnpm exec vitest run scripts/harness/__tests__/example.test.mjs',
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
    // Every verify command is recorded verbatim with its exit, on both criteria.
    expect(text).toMatch(
      /GATE-VERIFY — Build passes[^\n]*: build-shaped `echo node scripts\/harness\/run-all-scans\.mjs --affected` → exit 0/,
    );
    expect(text).toMatch(
      /GATE-VERIFY — Tests pass[^\n]*: test-shaped `echo pnpm exec vitest run scripts\/harness\/__tests__\/example\.test\.mjs` → exit 0/,
    );
    const advanced = run(root, ['advance', '--doc', doc]);
    expect(advanced.status, advanced.stderr).toBe(0);
    expect(existsSync(path.join(root, `.agents/spec-docs/done/${SPEC_ID}.md`))).toBe(true);
  });

  /**
   * Round-A finding 7: "Build passes" / "Tests pass" accepted ANY exit-0 `--verify-cmd` — `true`
   * satisfied both. The tests criterion needs at least one supplied command containing `test` or
   * `vitest`; the build criterion needs one containing `build`, `harness:scan` or `run-all-scans`
   * (the build-equivalent for a scope with no package build, such as `scripts/**`-only changes).
   */
  it('DONE with `--verify-cmd true` fails BOTH verify criteria naming the shape rule, though the command exits 0', () => {
    const spec =
      conformingSpec({ status: 'approved', folder: 'todo', ticked: true }).replace(
        '| fixture with the tree                 |       |',
        '| fixture with the tree                 | skipped: needs a live tree |',
      ) +
      `\n### [GATE-PLAN] — ✅ PASS | ${DATE}\n\n**Status upgrade:** draft → approved\n\n- GATE-WRITE — a criterion: judged\n`;
    const { root, doc } = makeWorkspace({ spec, folder: 'todo' });
    for (const tc of ['TC-01', 'TC-02'])
      expect(
        run(root, ['record', '--doc', doc, '--tc', tc, '--skip', 'by hand', '--date', DATE]).status,
      ).toBe(0);
    const result = judge(root, doc, 'DONE', ['--lane', 'L1', '--verify-cmd', 'true']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    const text = readFileSync(doc, 'utf8');
    expect(text).toContain(`### [GATE-DONE] — ❌ FAIL | ${DATE}`);
    expect(text).toMatch(
      /GATE-VERIFY — Build passes[^\n]*: no supplied --verify-cmd contains `build`, `harness:scan` or `run-all-scans` \(supplied: `true` → exit 0\)/,
    );
    expect(text).toMatch(
      /GATE-VERIFY — Tests pass[^\n]*: no supplied --verify-cmd contains `test` or `vitest` \(supplied: `true` → exit 0\)/,
    );
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
      conformingSpec({ status: 'approved', folder: 'todo', lane: 'L2' }) +
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
    const written = readFileSync(doc, 'utf8');
    expect(written).toContain('**Status upgrade:** approved → in-progress');
    const contracts = parseCheckpointEvidenceContracts(
      readFileSync(path.join(root, '.agents/rules/backlog-execution.md'), 'utf8'),
    ).contracts;
    const entry = evidenceEntries(written).at(-1);
    const parsed = parseCheckpointEvidence(
      contracts.get(2),
      'gateImplementFirst',
      entry.lines.join('\n'),
    );
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    expect(parsed.payload).toMatchObject({
      version: 2,
      deliveryMode: 'single',
      sequencedArtifacts: [],
    });
    expect(parsed.payload.specPath).toBe(`.agents/spec-docs/todo/${SPEC_ID}.md`);
  });

  it('advance prepares the approved Task/spec pair together after GATE-IMPLEMENT PASS', () => {
    const { root, doc } = approvedWorkspace();
    gitInit(root);
    writeFileSync(
      path.join(root, TASK_REL),
      `${readFileSync(path.join(root, TASK_REL), 'utf8')}\n`,
    );
    writeFileSync(doc, `${readFileSync(doc, 'utf8')}\n`);
    const judged = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);
    expect(judged.status, judged.stdout + judged.stderr).toBe(0);

    const advanced = run(root, ['advance', '--doc', doc]);

    expect(advanced.status, advanced.stdout + advanced.stderr).toBe(0);
    const active = path.join(root, `.agents/spec-docs/active/${SPEC_ID}.md`);
    expect(readFileSync(active, 'utf8')).toContain('status: in-progress');
    expect(readFileSync(path.join(root, TASK_REL), 'utf8')).toContain('status: in-progress');
  });

  it('advance refuses GATE-IMPLEMENT half-activation states before mutating either artifact', () => {
    for (const halfState of ['task-already-active', 'task-missing']) {
      const { root, doc } = approvedWorkspace();
      gitInit(root);
      writeFileSync(
        path.join(root, TASK_REL),
        `${readFileSync(path.join(root, TASK_REL), 'utf8')}\n`,
      );
      writeFileSync(doc, `${readFileSync(doc, 'utf8')}\n`);
      const judged = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);
      expect(judged.status, judged.stdout + judged.stderr).toBe(0);
      if (halfState === 'task-already-active') {
        writeFileSync(
          path.join(root, TASK_REL),
          readFileSync(path.join(root, TASK_REL), 'utf8').replace(
            'status: todo',
            'status: in-progress',
          ),
        );
      } else {
        rmSync(path.join(root, TASK_REL));
      }
      const specBefore = readFileSync(doc, 'utf8');

      const advanced = run(root, ['advance', '--doc', doc]);

      expect(advanced.status).toBe(1);
      expect(advanced.stderr).toMatch(/paired Task.*(?:todo|required|not on disk)/i);
      expect(readFileSync(doc, 'utf8')).toBe(specBefore);
      expect(existsSync(path.join(root, `.agents/spec-docs/active/${SPEC_ID}.md`))).toBe(false);
    }
  });

  it('judges a native continuation against the annotated ordering row and writes exact v2 evidence', () => {
    const task = TASK.replace('status: todo', 'status: in-progress');
    const spec = conformingSpec({ status: 'in-progress', folder: 'active', lane: 'L2' }).replace(
      '**Delivery mode:** `single`',
      '**Delivery mode:** `sequenced`\n\n**Continuation artifacts:** `scripts/harness/gate.mjs`',
    );
    const { root, doc } = makeWorkspace({ spec, folder: 'active', task });
    const git = gitInit(root);
    const contracts = parseCheckpointEvidenceContracts(
      readFileSync(path.join(root, '.agents/rules/backlog-execution.md'), 'utf8'),
    ).contracts;
    const firstPayload = {
      version: 2,
      form: 'gateImplementFirst',
      deliveryMode: 'sequenced',
      sequencedArtifacts: ['scripts/harness/gate.mjs'],
      taskPath: TASK_REL,
      specPath: `.agents/spec-docs/todo/${SPEC_ID}.md`,
      taskItems: [
        { kind: 'tc-id', value: 'TC-01' },
        { kind: 'tc-id', value: 'TC-02' },
      ],
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [`.agents/spec-docs/todo/${SPEC_ID}.md`, TASK_REL].sort(),
    };
    const first = formatCheckpointEvidence(contracts.get(2), 'gateImplementFirst', firstPayload);
    if (!first.ok) throw new Error(first.error);
    writeFileSync(
      doc,
      `${readFileSync(doc, 'utf8')}\n### [GATE-IMPLEMENT] — ✅ PASS | ${DATE}\n\n**Status upgrade:** approved → in-progress\n\n${first.text}\n`,
    );
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first sequenced checkpoint']);
    const ancestorSha = git(['rev-parse', 'HEAD']).stdout.trim();
    const parentSpec = readFileSync(doc, 'utf8');
    writeFileSync(doc, `${parentSpec}\n`);
    const priorRaw = rawGateImplementPassEntries(readFileSync(doc, 'utf8')).at(-1);

    const result = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2', '--continuation']);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    const written = readFileSync(doc, 'utf8');
    expect(written).toContain('**Status upgrade:** in-progress → in-progress (continuation)');
    expect(written).not.toContain('status `approved` expected');
    const continuation = parseCheckpointEvidence(
      contracts.get(2),
      'gateImplementContinuation',
      evidenceEntries(written).at(-1).lines.join('\n'),
    );
    expect(continuation.ok, continuation.ok ? '' : continuation.error).toBe(true);
    expect(continuation.payload).toEqual({
      version: 2,
      form: 'gateImplementContinuation',
      deliveryMode: 'sequenced',
      sequencedArtifacts: ['scripts/harness/gate.mjs'],
      priorPass: priorPassDigest(priorRaw),
      ancestorSha,
      taskPath: TASK_REL,
      specPath: `.agents/spec-docs/active/${SPEC_ID}.md`,
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [`.agents/spec-docs/active/${SPEC_ID}.md`, TASK_REL].sort(),
    });
  });

  it('produces a first v2 checkpoint whose native continuation replays end to end', () => {
    const { root, doc } = approvedWorkspace();
    writeFileSync(
      doc,
      readFileSync(doc, 'utf8').replace(
        '**Delivery mode:** `single`',
        '**Delivery mode:** `sequenced`\n\n**Continuation artifacts:** `scripts/harness/gate.mjs`',
      ),
    );
    writeFileSync(
      path.join(root, TASK_REL),
      readFileSync(path.join(root, TASK_REL), 'utf8').replace(
        `# ${SPEC_ID}: fixture task`,
        '# PROC-999: fixture task',
      ),
    );
    const git = gitInit(root);
    const base = git(['rev-parse', 'HEAD']).stdout.trim();
    writeFileSync(
      path.join(root, TASK_REL),
      `${readFileSync(path.join(root, TASK_REL), 'utf8')}\n`,
    );
    writeFileSync(doc, `${readFileSync(doc, 'utf8')}\n`);

    const first = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const advanced = run(root, ['advance', '--doc', doc]);
    expect(advanced.status, advanced.stdout + advanced.stderr).toBe(0);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first v2 planning checkpoint']);
    const firstHead = git(['rev-parse', 'HEAD']).stdout.trim();
    git(['update-ref', 'refs/remotes/origin/develop', firstHead]);

    const active = path.join(root, `.agents/spec-docs/active/${SPEC_ID}.md`);
    writeFileSync(active, `${readFileSync(active, 'utf8')}\n`);
    const continuation = judge(root, active, 'GATE-IMPLEMENT', ['--lane', 'L2', '--continuation']);
    expect(continuation.status, continuation.stdout + continuation.stderr).toBe(0);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'native v2 continuation']);

    expect(base).not.toBe(firstHead);
    expect(findHistoryFindings(root)).toEqual([]);
  });

  it('writes a zero-checkbox TC-ID payload that the staged consumer accepts (TC-03)', () => {
    const zeroCheckboxTask = TASK.replace(
      '- [x] TC-01: write the refusal fixture\n- [x] TC-02: write the control fixture',
      'TC-01 and TC-02 are both covered by the fixture implementation plan.',
    )
      .replace(`# ${SPEC_ID}: fixture task`, '# PROC-999: fixture task')
      .replace(
        'Harness-only change.',
        'Not applicable because this repository-internal harness fixture exposes no product command, UI, SDK, or runtime behavior.',
      );
    const { root, doc } = approvedWorkspace();
    writeFileSync(path.join(root, TASK_REL), zeroCheckboxTask);
    const git = gitInit(root);
    const base = git(['rev-parse', 'HEAD']).stdout.trim();
    writeFileSync(path.join(root, TASK_REL), `${zeroCheckboxTask}\nplanning checkpoint update\n`);
    writeFileSync(doc, `${readFileSync(doc, 'utf8')}\n`);

    const result = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const written = readFileSync(doc, 'utf8');
    const contract = parseCheckpointEvidenceContracts(
      readFileSync(path.join(root, '.agents/rules/backlog-execution.md'), 'utf8'),
    ).contracts.get(2);
    const parsed = parseCheckpointEvidence(
      contract,
      'gateImplementFirst',
      evidenceEntries(written).at(-1).lines.join('\n'),
    );
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    expect(parsed.payload.taskItems).toEqual([
      { kind: 'tc-id', value: 'TC-01' },
      { kind: 'tc-id', value: 'TC-02' },
    ]);

    const active = path.join(root, `.agents/spec-docs/active/${SPEC_ID}.md`);
    mkdirSync(path.dirname(active), { recursive: true });
    renameSync(doc, active);
    writeFileSync(
      active,
      readFileSync(active, 'utf8').replace('status: approved', 'status: in-progress'),
    );
    writeFileSync(
      path.join(root, TASK_REL),
      readFileSync(path.join(root, TASK_REL), 'utf8').replace(
        'status: todo',
        'status: in-progress',
      ),
    );
    git(['add', '-A']);

    expect(findStagedFindings(root, base)).toEqual([]);
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
    expect(readFileSync(doc, 'utf8')).toContain(`names \`${TASK_REL}\`, which does not exist`);
  });

  it('fails when the Task named in ## Tasks exists only under the archived completed directory', () => {
    const archivedRel = `.agents/tasks/completed/${SPEC_ID}.md`;
    const { root, doc } = approvedWorkspace();
    const spec = readFileSync(doc, 'utf8').replace(TASK_REL, archivedRel);
    writeFileSync(doc, spec);
    mkdirSync(path.dirname(path.join(root, archivedRel)), { recursive: true });
    writeFileSync(path.join(root, archivedRel), TASK + '\n');
    gitInit(root);
    const result = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);
    expect(result.status).toBe(1);
    expect(readFileSync(doc, 'utf8')).toContain(
      `names \`${archivedRel}\`, which is not an active root Task path`,
    );
  });

  it('fails GATE-IMPLEMENT when a strict not-applicable PLAN reason is thin', () => {
    const { root, doc } = approvedWorkspace();
    gitInit(root);
    writeFileSync(
      path.join(root, TASK_REL),
      readFileSync(path.join(root, TASK_REL), 'utf8').replace(
        '**Reason:** This fixture changes repository lifecycle governance only and exposes no runnable Robota product surface for any user.',
        '**Reason:** too short',
      ),
    );
    writeFileSync(doc, `${readFileSync(doc, 'utf8')}\n`);

    const result = judge(root, doc, 'GATE-IMPLEMENT', ['--lane', 'L2']);

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/not-applicable.*reason|substantive/i);
  });
});

describe('the review fingerprint reads the VALUES of type: and tags: (PR #2419 review)', () => {
  const doc = (tags) =>
    `---\nstatus: draft\ntype: RULE\n${tags}\n---\n\n## Architecture Review\n\nsame\n`;

  it('a changed block-sequence tag item changes the fingerprint', () => {
    const before = reviewFingerprint(doc('tags:\n  - api\n  - west'));
    const after = reviewFingerprint(doc('tags:\n  - api\n  - east'));
    expect(after.typeTags).not.toBe(before.typeTags);
    expect(after.combined).not.toBe(before.combined);
  });

  it('the same tags in flow and block form fingerprint alike, and a type change moves it', () => {
    const flow = reviewFingerprint(doc('tags: [api, west]'));
    const block = reviewFingerprint(doc('tags:\n  - api\n  - west'));
    expect(block.typeTags).toBe(flow.typeTags);
    const retyped = reviewFingerprint(
      doc('tags: [api, west]').replace('type: RULE', 'type: INFRA'),
    );
    expect(retyped.typeTags).not.toBe(flow.typeTags);
  });
});
