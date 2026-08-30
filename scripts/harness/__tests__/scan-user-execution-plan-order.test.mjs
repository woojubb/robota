import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  formatCheckpointEvidence,
  parseCheckpointEvidenceContract,
  priorPassDigest,
  rawGateImplementPassEntries,
} from '../checkpoint-evidence-contract.mjs';
import {
  evaluatePlanTexts,
  findHistoryFindings as findHistoryFindingsFromGit,
  findStagedFindings,
  readExaminedPlanOrderCount,
  CONTINUATION_STATUS_LINE,
  FIRST_CHECKPOINT_STATUS_LINE as FIRST_STATUS_LINE,
  resolveTopicMergeBase,
} from '../scan-user-execution-plan-order.mjs';

const TASK_ID = 'HARNESS-900-plan-order-fixture';
const TASK_PATH = `.agents/tasks/${TASK_ID}.md`;
const SPEC_PATH = `.agents/spec-docs/active/${TASK_ID}.md`;
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LIVE_BACKLOG_RULE = readFileSync(
  path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
  'utf8',
);
const LIVE_CONTRACT = parseCheckpointEvidenceContract(LIVE_BACKLOG_RULE).contract;
const execFileAsync = promisify(execFile);

// These integration fixtures create and inspect real temporary Git repositories. A focused `-t` run
// can make an individual fixture exceed Vitest's 10-second unit-test default even though it is still
// progressing; keep a bounded file-level allowance while the few whole-history subprocess cases retain
// their explicit 300-second bounds below.
vi.setConfig({ testTimeout: 30_000 });

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function write(root, relative, text) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  repositoryMetadata.get(root)?.dirtyPaths.add(relative);
}

function readOptional(root, relative) {
  try {
    return readFileSync(path.join(root, relative), 'utf8');
  } catch {
    return null;
  }
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message]);
  const head = git(root, ['rev-parse', 'HEAD']);
  const metadata = repositoryMetadata.get(root);
  if (metadata) {
    metadata.commits += 1;
    metadata.lastCommitPaths = new Set(metadata.dirtyPaths);
    metadata.dirtyPaths.clear();
    if (metadata.fastRange && metadata.commits > metadata.fastRange.markedCommits) {
      metadata.fastRange = null;
    }
  }
  return head;
}

const repositorySeeds = new Map();
const repositoryMetadata = new Map();

function createRepositorySeed({ taskInBase, withContract }) {
  const root = makeTemp('robota-ues-plan-order-seed-');
  git(root, ['init', '-b', 'develop']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture']);
  write(root, 'README.md', 'base\n');
  if (withContract) write(root, '.agents/rules/backlog-execution.md', LIVE_BACKLOG_RULE);
  if (taskInBase) {
    write(
      root,
      TASK_PATH,
      ['---', 'status: todo', '---', '', `# ${TASK_ID}`, '', '## Test Plan', '', 'base task'].join(
        '\n',
      ),
    );
  }
  const base = commit(root, 'base (#1)');
  git(root, ['update-ref', 'refs/remotes/origin/develop', base]);
  git(root, ['switch', '-q', '-c', 'feature']);
  return { root, base };
}

function repository({ taskInBase = false, withContract = false } = {}) {
  const key = `${taskInBase}:${withContract}`;
  let seed = repositorySeeds.get(key);
  if (!seed) {
    seed = createRepositorySeed({ taskInBase, withContract });
    repositorySeeds.set(key, seed);
  }

  const root = makeTemp('robota-ues-plan-order-');
  cpSync(seed.root, root, { recursive: true });
  repositoryMetadata.set(root, {
    base: seed.base,
    commits: 0,
    dirtyPaths: new Set(),
    lastCommitPaths: new Set(),
    taskInBase,
    fastRange: null,
    sequenceBase: null,
  });
  return { root, base: seed.base };
}

function taskText({
  outcome = 'not-applicable',
  stage1 = false,
  subject = TASK_ID,
  browserAutomatable = false,
} = {}) {
  const subjectId = /^([A-Z][A-Z0-9]*-\d+)/.exec(subject)?.[1] ?? subject;
  const signal =
    outcome === 'not-applicable'
      ? 'SCENARIO DRAFTED: not-applicable | 0'
      : `SCENARIO DRAFTED: ${outcome} | 1`;
  const manualInvocation = 'open Robota browser UI and activate the fixture control';
  const manualCapability = 'operating-system security-key prompt interaction';
  const manualAttempt =
    'browser automation probe cannot access the operating-system security-key prompt';
  const observable =
    outcome === 'manual' || browserAutomatable
      ? 'visible=fixture control active in browser UI'
      : 'exit=0; output-contains=visible result';
  const surfaceRationale =
    outcome === 'manual' || browserAutomatable
      ? 'shipped-interface=robota-browser-ui'
      : 'shipped-entrypoint=robota';
  const observableRationale =
    outcome === 'manual' || browserAutomatable
      ? 'source=rendered-product-ui'
      : 'source=product-process';
  const stageBinding =
    outcome === 'manual'
      ? `Scenario 1 — surface=robota-browser-ui; surface-rationale=${surfaceRationale}; invocation=${manualInvocation}; observable-type=ui-state; observable=${observable}; observable-rationale=${observableRationale}; barrier=physical-device; unavailable-capability=${manualCapability}; attempted-automation=${manualAttempt}; guardian-observable-verdict=product-behavior; `
      : browserAutomatable
        ? `Scenario 1 — surface=robota-browser-ui; surface-rationale=${surfaceRationale}; invocation=${manualInvocation}; observable-type=ui-state; observable=${observable}; observable-rationale=${observableRationale}; guardian-observable-verdict=product-behavior; `
        : `Scenario 1 — surface=robota-cli; surface-rationale=${surfaceRationale}; invocation=robota fixture; observable-type=product-output; observable=${observable}; observable-rationale=${observableRationale}; guardian-observable-verdict=product-behavior; `;
  return [
    '---',
    'status: in-progress',
    '---',
    '',
    `# ${subjectId}: fixture`,
    '',
    '## Test Plan',
    '',
    'TC-01: this fixture carries more than fifty characters of concrete verification planning.',
    '',
    '## User Execution Test Scenarios',
    '',
    `**Author verdict:** \`${signal}\``,
    '',
    outcome === 'not-applicable'
      ? 'Not applicable because this fixture changes repository lifecycle governance only and exposes no product surface.'
      : [
          '### Scenario 1',
          '',
          outcome === 'manual'
            ? '- executability: manual-only: browser security-key prompt requires physical device interaction'
            : '- executability: agent-executable',
          outcome === 'manual' || browserAutomatable
            ? '- product surface: robota-browser-ui'
            : '- product surface: robota-cli',
          `- surface rationale: ${surfaceRationale}`,
          '- prerequisites: fixture repository initialized',
          outcome === 'manual'
            ? `- UI steps: ${manualInvocation}`
            : browserAutomatable
              ? `- browser steps: ${manualInvocation}`
              : '- command: `robota fixture`',
          ...(outcome === 'manual'
            ? [
                '- automation barrier: physical-device',
                `- unavailable capability: ${manualCapability}`,
                `- attempted automation: ${manualAttempt}`,
              ]
            : []),
          outcome === 'manual' || browserAutomatable
            ? '- observable type: ui-state'
            : '- observable type: product-output',
          `- expected observable: ${observable}`,
          `- observable rationale: ${observableRationale}`,
          '- cleanup: none',
          '- evidence: pending',
        ].join('\n'),
    '',
    ...(stage1
      ? [
          '### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-25',
          '',
          '**Status upgrade:** scenario drafted → scenario written',
          '',
          `- ${stageBinding}executability, prerequisites, command/UI steps, expected observable, cleanup, and evidence field: complete.`,
          '',
        ]
      : []),
  ].join('\n');
}

function conversionTaskText(baseOid) {
  return `${taskText().replace(
    'status: in-progress',
    'status: in-progress\nissue: https://github.com/woojubb/robota/issues/900',
  )}\n\nConversion evidence: issue=https://github.com/woojubb/robota/issues/900; task=HARNESS-900; marker=https://github.com/woojubb/robota/issues/900#issuecomment-1; marker-readback=2026-08-29T00:00:00Z; priority-removed=2026-08-29T00:00:01Z; base=develop; base-oid=${baseOid}\n\nCombined lifecycle eligibility: eligible; work-kind=enhancement; priority=P0; issue-state=OPEN; child-causes=0; security=none; data-correctness=none; user-decision=none; contract-change=none; owner-count=1\n`;
}

function v1AutomatableBrowserTask() {
  const invocation = 'open Robota browser UI and activate the fixture control';
  const observable = 'visible=fixture control active in browser UI';
  const payload = formatCheckpointEvidence(LIVE_CONTRACT, 'doneGateStageOne', {
    version: 1,
    form: 'doneGateStageOne',
    outcome: 'automatable',
    scenarios: [
      {
        name: 'Scenario 1',
        surface: 'robota-browser-ui',
        surfaceRationale: 'shipped-interface=robota-browser-ui',
        invocation,
        observableType: 'ui-state',
        observable,
        observableRationale: 'source=rendered-product-ui',
        guardianObservableVerdict: 'product-behavior',
        executability: 'agent-executable',
        prerequisite: 'fixture repository initialized',
        action: { kind: 'browserSteps', value: invocation },
        expectedObservable: observable,
        cleanup: 'none',
        evidence: 'pending',
      },
    ],
  });
  if (!payload.ok) throw new Error(payload.error);
  return `${taskText({ outcome: 'automatable', stage1: true, browserAutomatable: true })}\n${payload.text}\n`;
}

function specText({
  subject = TASK_ID,
  outcome = 'not-applicable',
  worktreeLine = undefined,
  v1 = false,
} = {}) {
  const signal =
    outcome === 'not-applicable'
      ? 'SCENARIO DRAFTED: not-applicable | 0'
      : `SCENARIO DRAFTED: ${outcome} | 1`;
  const payload = v1
    ? formatCheckpointEvidence(LIVE_CONTRACT, 'gateImplementFirst', {
        version: 1,
        form: 'gateImplementFirst',
        taskPath: `.agents/tasks/${subject}.md`,
        specPath: `.agents/spec-docs/todo/${subject}.md`,
        taskItems: [{ kind: 'tc-id', value: 'TC-01' }],
        plan: { outcome, count: outcome === 'not-applicable' ? 0 : 1 },
        worktreePaths: [`.agents/spec-docs/todo/${subject}.md`, `.agents/tasks/${subject}.md`],
      }).text
    : null;
  return [
    '---',
    'status: in-progress',
    'type: INFRA',
    'tags: [async]',
    '---',
    '',
    `# ${subject}`,
    '',
    '## Completion Criteria',
    '',
    '- [ ] TC-01: the checkpoint binding is accepted.',
    '',
    '## Tasks',
    '',
    `- [x] \`.agents/tasks/${subject}.md\``,
    '',
    '## Evidence Log',
    '',
    '### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25',
    '',
    '**Status upgrade:** approved → in-progress',
    '',
    `- Task artifact: \`.agents/tasks/${subject}.md\` exists and maps the completion criteria.`,
    `- Subject-bound PLAN terminal result: \`${signal}\` is recorded with its concrete reason.`,
    worktreeLine ??
      `- Whole-worktree precondition: only \`.agents/tasks/${subject}.md\` and \`.agents/spec-docs/todo/${subject}.md\` are present; no implementation path exists.`,
    ...(payload ? [payload] : []),
    '',
  ].join('\n');
}

function writeCheckpoint(root, options = {}) {
  write(root, TASK_PATH, taskText(options));
  write(root, SPEC_PATH, specText(options));
}

function checkpoint(root, options = {}) {
  writeCheckpoint(root, options);
  return commit(root, 'planning checkpoint');
}

function continuationSpecText(options = {}) {
  // The spec after a GATE-IMPLEMENT re-run on the in-progress document (HARNESS-131): one more
  // complete entry, in continuation form, bound to the same PLAN signal and Task path.
  const subject = options.subject ?? TASK_ID;
  const signal =
    (options.outcome ?? 'not-applicable') === 'not-applicable'
      ? 'SCENARIO DRAFTED: not-applicable | 0'
      : `SCENARIO DRAFTED: ${options.outcome} | 1`;
  // `firstOutcome` keeps the FIRST entry's signal while the continuation entry names `outcome` —
  // the shape of a continuation that re-plans the PLAN outcome.
  const { firstOutcome, ...rest } = options;
  return (
    specText({ ...rest, outcome: firstOutcome ?? rest.outcome }) +
    [
      '### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-28',
      '',
      options.statusLine ?? CONTINUATION_STATUS_LINE,
      '',
      `- Task artifact: \`.agents/tasks/${subject}.md\` is unchanged and still maps the completion criteria.`,
      `- Subject-bound PLAN terminal result: \`${signal}\` stands.`,
      `- Whole-worktree precondition: only \`.agents/tasks/${subject}.md\` and \`.agents/spec-docs/active/${subject}.md\` are present; no implementation path.`,
      '',
    ].join('\n')
  );
}

function sequencedRepository() {
  // develop already carries the pair in-progress with its first checkpoint — PR 1 of a sequenced
  // delivery has landed — and the branch for PR 2 is cut from that tip.
  const { root } = repository();
  git(root, ['switch', '-q', 'develop']);
  writeCheckpoint(root);
  const base = commit(root, 'PR 1 landed: planning checkpoint on develop');
  git(root, ['update-ref', 'refs/remotes/origin/develop', base]);
  git(root, ['switch', '-q', '-c', 'feature-2']);
  repositoryMetadata.get(root).sequenceBase = {
    base,
    parentTask: readFileSync(path.join(root, TASK_PATH), 'utf8'),
    parentSpec: readFileSync(path.join(root, SPEC_PATH), 'utf8'),
    startCommits: repositoryMetadata.get(root).commits,
  };
  return { root, base };
}

function continuation(root, options = {}) {
  write(root, SPEC_PATH, continuationSpecText(options));
  const head = commit(root, 'continuation checkpoint');
  const metadata = repositoryMetadata.get(root);
  if (
    metadata?.sequenceBase &&
    metadata.fastRange === null &&
    metadata.commits === metadata.sequenceBase.startCommits + 1
  ) {
    metadata.fastRange = {
      ...metadata.sequenceBase,
      ancestorSha: null,
      baseOid: null,
      markedCommits: metadata.commits,
    };
  }
  return head;
}

function v1SequencedRepository({
  mutateParentSpec = (spec) => spec,
  mutatePayload = (payload) => payload,
  mutateContinuationSpec = (spec) => spec,
  mutateContinuationTask = (task) => task,
  withUnrelatedMerge = false,
  withConversionEvidence = false,
  withNonAncestorConversionBase = false,
  squashFirstPr = false,
} = {}) {
  const { root, base: repositoryBase } = repository({ withContract: true });
  let conversionBase = repositoryBase;
  if (withNonAncestorConversionBase) {
    git(root, ['switch', '-q', '-c', 'conversion-base-sibling', repositoryBase]);
    write(root, 'SIBLING.md', 'conversion base outside the checkpoint ancestry\n');
    conversionBase = commit(root, 'non-ancestor conversion base');
    git(root, ['switch', '-q', 'feature']);
  }
  write(root, TASK_PATH, withConversionEvidence ? conversionTaskText(conversionBase) : taskText());
  write(
    root,
    SPEC_PATH,
    mutateParentSpec(
      specText({
        v1: true,
        worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
      }).replace(
        '## Evidence Log',
        '## Architecture Review\n\n### Decision\n\n**Continuation artifacts:** `scripts/harness/gate.mjs`, `scripts/harness/scan-user-execution-plan-order.mjs`\n\n## Evidence Log',
      ),
    ),
  );
  commit(root, 'PR 1 v1 checkpoint');
  git(root, ['switch', '-q', 'develop']);
  let sequencedMerge;
  if (squashFirstPr) {
    git(root, ['merge', '--squash', '-q', 'feature']);
    sequencedMerge = commit(root, 'squash merge PR 1 (#1)');
  } else {
    git(root, ['merge', '--no-ff', '-q', '-m', 'merge PR 1', 'feature']);
    sequencedMerge = git(root, ['rev-parse', 'HEAD']);
  }
  if (withUnrelatedMerge) {
    git(root, ['switch', '-q', '-c', 'unrelated']);
    write(root, 'UNRELATED.md', 'unrelated branch\n');
    commit(root, 'unrelated change');
    git(root, ['switch', '-q', 'develop']);
    git(root, ['merge', '--no-ff', '-q', '-m', 'merge unrelated PR', 'unrelated']);
  }
  const base = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/remotes/origin/develop', base]);
  git(root, ['switch', '-q', '-c', 'feature-2']);

  const parentTask = readFileSync(path.join(root, TASK_PATH), 'utf8');
  write(root, TASK_PATH, mutateContinuationTask(parentTask, { base, conversionBase }));

  const priorSpec = readFileSync(path.join(root, SPEC_PATH), 'utf8');
  const priorRaw = rawGateImplementPassEntries(priorSpec).at(-1);
  const payload = mutatePayload(
    {
      version: 1,
      form: 'gateImplementContinuation',
      priorPass: priorPassDigest(priorRaw),
      sequencedArtifacts: [
        'scripts/harness/gate.mjs',
        'scripts/harness/scan-user-execution-plan-order.mjs',
      ],
      ancestorSha: base,
      taskPath: TASK_PATH,
      specPath: SPEC_PATH,
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [SPEC_PATH, TASK_PATH].sort(),
    },
    { priorSpec },
  );
  const rendered = formatCheckpointEvidence(LIVE_CONTRACT, 'gateImplementContinuation', payload);
  if (!rendered.ok) throw new Error(rendered.error);
  write(
    root,
    SPEC_PATH,
    mutateContinuationSpec(
      `${priorSpec}### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29\n\n${CONTINUATION_STATUS_LINE}\n\n${rendered.text}\n`,
    ),
  );
  commit(root, 'v1 continuation checkpoint');
  const metadata = repositoryMetadata.get(root);
  metadata.fastRange = {
    base,
    parentTask,
    parentSpec: priorSpec,
    ancestorSha: sequencedMerge,
    baseOid: withConversionEvidence ? conversionBase : null,
    markedCommits: metadata.commits,
  };
  if (withNonAncestorConversionBase) metadata.fastRange = null;
  return { root, base, conversionBase, sequencedMerge };
}

function postMergeRecord(base, runId = 'r20260825000000') {
  return {
    runId,
    opened: '2026-08-25T00:00:00.000Z',
    closed: '2026-08-25T00:01:00.000Z',
    roundFindings: [0],
    terminal: 'converged',
    ref: `PR #1 MERGE VERIFIED PASS ${base}`,
  };
}

function userScenarioRecord(ref = TASK_ID, runId = 'r20260825000000') {
  return {
    runId,
    opened: '2026-08-25T00:00:00.000Z',
    closed: '2026-08-25T00:01:00.000Z',
    roundFindings: [0],
    extensions: {},
    terminal: 'converged',
    ref,
  };
}

function findHistoryFindings(root, requestedBase) {
  const metadata = repositoryMetadata.get(root);
  const exactCheckpointPaths = [SPEC_PATH, TASK_PATH].sort();
  const fastPathEligible =
    metadata &&
    metadata.base === requestedBase &&
    metadata.commits === 1 &&
    metadata.dirtyPaths.size === 0 &&
    !metadata.taskInBase &&
    metadata.lastCommitPaths.size === exactCheckpointPaths.length &&
    exactCheckpointPaths.every((file) => metadata.lastCommitPaths.has(file));
  const readCurrent = (relative) => readOptional(root, relative);
  const fastRange = metadata?.fastRange;
  if (
    fastRange &&
    fastRange.base === requestedBase &&
    fastRange.markedCommits === metadata.commits &&
    metadata.dirtyPaths.size === 0
  ) {
    const problems = evaluatePlanTexts({
      basename: path.basename(TASK_PATH),
      parentTask: fastRange.parentTask,
      parentSpec: fastRange.parentSpec,
      task: readCurrent(TASK_PATH),
      spec: readCurrent(SPEC_PATH),
      ruleText: readCurrent('.agents/rules/backlog-execution.md'),
      checkpointOptions: {
        ancestorSha: fastRange.ancestorSha,
        baseOid: fastRange.baseOid,
        checkpointPaths: exactCheckpointPaths,
        legacyEntries: [],
      },
    });
    return problems.map((problem) => ({ commit: null, problem }));
  }
  if (!fastPathEligible) return findHistoryFindingsFromGit(root, requestedBase);

  const problems = evaluatePlanTexts({
    basename: path.basename(TASK_PATH),
    task: readCurrent(TASK_PATH),
    spec: readCurrent(SPEC_PATH),
    ruleText: readCurrent('.agents/rules/backlog-execution.md'),
    checkpointOptions: {
      checkpointPaths: exactCheckpointPaths,
      legacyEntries: [],
    },
  });
  return problems.map((problem) => ({ commit: null, problem }));
}

function messages(findings) {
  return findings.map((finding) => finding.problem).join('\n');
}

describe('shared repository fixture isolation', () => {
  it('keeps copied worktrees and refs independent from each other and the immutable seed', () => {
    const first = repository({ withContract: true });
    const second = repository({ withContract: true });

    write(first.root, 'FIRST.md', 'first fixture only\n');
    const firstHead = commit(first.root, 'mutate first fixture');

    expect(firstHead).not.toBe(first.base);
    expect(git(second.root, ['rev-parse', 'HEAD'])).toBe(second.base);
    expect(git(second.root, ['status', '--porcelain'])).toBe('');

    const third = repository({ withContract: true });
    expect(git(third.root, ['rev-parse', 'HEAD'])).toBe(third.base);
    expect(git(third.root, ['status', '--porcelain'])).toBe('');
  });
});

describe('fast fixture projection parity with production Git discovery', () => {
  it.each([
    ['valid v1 checkpoint', { v1: true }],
    ['invalid v1 checkpoint', { v1: true, manifestSpecPath: '.agents/spec-docs/active/WRONG.md' }],
  ])('%s', (_label, options) => {
    const fixture = repository({ withContract: true });
    checkpoint(fixture.root, options);

    expect(findHistoryFindings(fixture.root, fixture.base)).toEqual(
      findHistoryFindingsFromGit(fixture.root, fixture.base),
    );
  });

  it('matches production discovery for a continuation checkpoint', () => {
    const fixture = sequencedRepository();
    continuation(fixture.root);

    expect(findHistoryFindings(fixture.root, fixture.base)).toEqual(
      findHistoryFindingsFromGit(fixture.root, fixture.base),
    );
  });
});

describe('user-execution PLAN order — branch history', () => {
  it('reads v1 first-checkpoint evidence from the checkpoint rule revision and names a mismatched specPath (TC-03, TC-08)', () => {
    const valid = repository({ withContract: true });
    checkpoint(valid.root, {
      v1: true,
      worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
    });
    expect(findHistoryFindings(valid.root, valid.base)).toEqual([]);

    const invalid = repository({ withContract: true });
    writeCheckpoint(invalid.root, {
      v1: true,
      worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
    });
    const current = readFileSync(path.join(invalid.root, SPEC_PATH), 'utf8');
    write(
      invalid.root,
      SPEC_PATH,
      current.replace(
        `.agents/spec-docs/todo/${TASK_ID}.md`,
        '.agents/spec-docs/todo/HARNESS-901-other.md',
      ),
    );
    commit(invalid.root, 'mismatched v1 spec binding');

    expect(
      findHistoryFindings(invalid.root, invalid.base)
        .map((item) => item.problem)
        .join('\n'),
    ).toMatch(/gateImplementFirst.*(?:specPath|basename)/i);
  });

  it('replays expected taskItems and reports the mismatched field by name', () => {
    const invalid = repository({ withContract: true });
    writeCheckpoint(invalid.root, {
      v1: true,
      worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
    });
    const current = readFileSync(path.join(invalid.root, SPEC_PATH), 'utf8');
    write(invalid.root, SPEC_PATH, current.replace('"value": "TC-01"', '"value": "TC-99"'));
    commit(invalid.root, 'mismatched v1 task items');

    expect(messages(findHistoryFindings(invalid.root, invalid.base))).toMatch(
      /gateImplementFirst\.taskItems.*Completion Criteria/i,
    );
  });

  it('binds a v1 Stage-1 payload to the authored browser scenario (TC-05)', () => {
    const valid = repository({ withContract: true });
    write(valid.root, TASK_PATH, v1AutomatableBrowserTask());
    write(
      valid.root,
      SPEC_PATH,
      specText({
        outcome: 'automatable',
        v1: true,
        worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
      }),
    );
    commit(valid.root, 'v1 browser scenario checkpoint');
    expect(findHistoryFindings(valid.root, valid.base)).toEqual([]);

    const invalid = repository({ withContract: true });
    write(
      invalid.root,
      TASK_PATH,
      v1AutomatableBrowserTask().replace(
        '"guardianObservableVerdict": "product-behavior"',
        '"guardianObservableVerdict": "engineering-check"',
      ),
    );
    write(
      invalid.root,
      SPEC_PATH,
      specText({
        outcome: 'automatable',
        v1: true,
        worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
      }),
    );
    commit(invalid.root, 'invalid v1 browser scenario checkpoint');
    expect(messages(findHistoryFindings(invalid.root, invalid.base))).toMatch(
      /guardianObservableVerdict.*product-behavior/,
    );
  });

  it('selects Stage-1 PASS only from the authoritative scenario section and binds its status envelope', () => {
    const unrelated = repository({ withContract: true });
    write(
      unrelated.root,
      TASK_PATH,
      v1AutomatableBrowserTask().replace(
        '## User Execution Test Scenarios',
        [
          '### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-20',
          '',
          '**Status upgrade:** unrelated → unrelated',
          '',
          '## User Execution Test Scenarios',
        ].join('\n'),
      ),
    );
    write(
      unrelated.root,
      SPEC_PATH,
      specText({
        outcome: 'automatable',
        v1: true,
        worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
      }),
    );
    commit(unrelated.root, 'authoritative v1 stage one section');
    expect(findHistoryFindings(unrelated.root, unrelated.base)).toEqual([]);

    const wrongUpgrade = repository({ withContract: true });
    write(
      wrongUpgrade.root,
      TASK_PATH,
      v1AutomatableBrowserTask().replace(
        '**Status upgrade:** scenario drafted → scenario written',
        '**Status upgrade:** scenario drafted → scenario executed',
      ),
    );
    write(
      wrongUpgrade.root,
      SPEC_PATH,
      specText({
        outcome: 'automatable',
        v1: true,
        worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
      }),
    );
    commit(wrongUpgrade.root, 'wrong v1 stage one status');
    expect(messages(findHistoryFindings(wrongUpgrade.root, wrongUpgrade.base))).toMatch(
      /doneGateStageOne\.statusUpgrade/i,
    );
  });

  it('binds v1 continuation to prior raw bytes and Decision artifacts (TC-04, TC-07)', () => {
    const valid = v1SequencedRepository();
    expect(findHistoryFindings(valid.root, valid.base)).toEqual([]);

    const badDigest = v1SequencedRepository({
      mutatePayload: (payload) => ({ ...payload, priorPass: `sha256:${'0'.repeat(64)}` }),
    });
    expect(messages(findHistoryFindings(badDigest.root, badDigest.base))).toMatch(
      /priorPass.*latest complete validated predecessor PASS/,
    );

    const badArtifacts = v1SequencedRepository({
      mutatePayload: (payload) => ({
        ...payload,
        sequencedArtifacts: ['scripts/harness/gate.mjs'],
      }),
    });
    expect(messages(findHistoryFindings(badArtifacts.root, badArtifacts.base))).toMatch(
      /sequencedArtifacts.*Decision/,
    );

    const badAncestor = v1SequencedRepository({
      mutatePayload: (payload) => ({ ...payload, ancestorSha: '0'.repeat(40) }),
    });
    expect(messages(findHistoryFindings(badAncestor.root, badAncestor.base))).toMatch(
      /ancestorSha.*preceding integration commit/,
    );
  });

  it('replays the immutable conversion base across a later continuation', () => {
    const fixture = v1SequencedRepository({ withConversionEvidence: true });

    expect(fixture.conversionBase).not.toBe(fixture.base);
    expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);
  });

  it('refuses conversion receipt mutation during continuation', () => {
    const changedTask = v1SequencedRepository({
      withConversionEvidence: true,
      mutateContinuationTask: (task) => `${task}\nchanged after the first checkpoint\n`,
    });
    expect(findHistoryFindings(changedTask.root, changedTask.base)).not.toEqual([]);

    const changedBase = v1SequencedRepository({
      withConversionEvidence: true,
      mutateContinuationTask: (task, { base, conversionBase }) =>
        task.replace(`base-oid=${conversionBase}`, `base-oid=${base}`),
    });
    expect(findHistoryFindings(changedBase.root, changedBase.base)).not.toEqual([]);

    const nonAncestor = v1SequencedRepository({
      withConversionEvidence: true,
      withNonAncestorConversionBase: true,
    });
    expect(() =>
      git(nonAncestor.root, [
        'merge-base',
        '--is-ancestor',
        nonAncestor.conversionBase,
        nonAncestor.base,
      ]),
    ).toThrow();
    expect(findHistoryFindings(nonAncestor.root, nonAncestor.base)).not.toEqual([]);
  });

  it('preserves every parent PASS byte-identically in prefix order before one append', () => {
    const mutations = {
      replacement: (spec) =>
        spec.replace(
          '**Status upgrade:** approved → in-progress',
          '**Status upgrade:** approved → in-progress ',
        ),
      deletion: (spec) => spec.replace(rawGateImplementPassEntries(spec)[0], ''),
      reorder: (spec) => {
        const entries = rawGateImplementPassEntries(spec);
        return spec.replace(entries.join(''), [entries[1], entries[0]].join(''));
      },
    };

    for (const [name, mutateContinuationSpec] of Object.entries(mutations)) {
      const fixture = v1SequencedRepository({ mutateContinuationSpec });
      const findings = messages(findHistoryFindings(fixture.root, fixture.base));

      if (name === 'replacement') {
        expect(findings, name).toMatch(/parent raw PASS entries.*exact prefix order.*exactly one/i);
      } else {
        expect(findings, name).not.toBe('');
      }
    }
  });

  it('accepts the Prettier blank separator before a continuation heading', () => {
    const fixture = v1SequencedRepository({
      mutateContinuationSpec: (spec) =>
        spec.replace(
          '<!-- checkpoint-evidence:v1:end -->\n### [GATE-IMPLEMENT]',
          '<!-- checkpoint-evidence:v1:end -->\n\n### [GATE-IMPLEMENT]',
        ),
    });
    const parentSpec = execFileSync('git', ['show', `${fixture.base}:${SPEC_PATH}`], {
      cwd: fixture.root,
      encoding: 'utf8',
    });
    const continuedSpec = readFileSync(path.join(fixture.root, SPEC_PATH), 'utf8');

    expect(rawGateImplementPassEntries(continuedSpec).slice(0, -1)).toEqual(
      rawGateImplementPassEntries(parentSpec),
    );

    expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);
  });

  it('rejects incomplete and invalid-date raw predecessors before a continuation', () => {
    const incomplete = v1SequencedRepository({
      mutateParentSpec: (spec) =>
        `${spec}### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-28\n\n${CONTINUATION_STATUS_LINE}\n`,
    });
    expect(messages(findHistoryFindings(incomplete.root, incomplete.base))).toMatch(
      /every prior canonical PASS.*complete and valid/i,
    );

    const invalidDate = v1SequencedRepository({
      mutateParentSpec: (spec) =>
        `${spec}### [GATE-IMPLEMENT] — ✅ PASS | 2026-99-99\n\n${CONTINUATION_STATUS_LINE}\n`,
      mutatePayload: (payload, { priorSpec }) => ({
        ...payload,
        priorPass: priorPassDigest(rawGateImplementPassEntries(priorSpec)[0]),
      }),
    });
    expect(messages(findHistoryFindings(invalidDate.root, invalidDate.base))).toMatch(
      /raw and canonical PASS populations must correspond exactly/i,
    );
  });

  it('binds continuation Decision artifacts to the exact base parent spec', () => {
    const changedAtCheckpoint = v1SequencedRepository({
      mutatePayload: (payload) => ({
        ...payload,
        sequencedArtifacts: ['scripts/harness/shared.mjs'],
      }),
      mutateContinuationSpec: (spec) =>
        spec.replace(
          '**Continuation artifacts:** `scripts/harness/gate.mjs`, `scripts/harness/scan-user-execution-plan-order.mjs`',
          '**Continuation artifacts:** `scripts/harness/shared.mjs`',
        ),
    });

    expect(
      messages(findHistoryFindings(changedAtCheckpoint.root, changedAtCheckpoint.base)),
    ).toMatch(/sequencedArtifacts.*base.*Decision/i);
  });

  it('binds ancestorSha to the merge that introduced the prior sequenced checkpoint', () => {
    const unrelatedLatest = v1SequencedRepository({ withUnrelatedMerge: true });

    expect(unrelatedLatest.base).not.toBe(unrelatedLatest.sequencedMerge);
    expect(messages(findHistoryFindings(unrelatedLatest.root, unrelatedLatest.base))).toMatch(
      /ancestorSha.*integration.*sequenced/i,
    );
  });

  it('binds ancestorSha to the squash commit that introduced the prior sequenced checkpoint', () => {
    const squashIntegrated = v1SequencedRepository({ squashFirstPr: true });

    expect(squashIntegrated.sequencedMerge).toBe(squashIntegrated.base);
    expect(findHistoryFindings(squashIntegrated.root, squashIntegrated.base)).toEqual([]);
  });

  it('validates each continuation against its own introduction context across three PRs', () => {
    const sequence = v1SequencedRepository();
    const nextDecision = '**Continuation artifacts:** `scripts/harness/shared.mjs`';
    const afterPr2 = readFileSync(path.join(sequence.root, SPEC_PATH), 'utf8').replace(
      '**Continuation artifacts:** `scripts/harness/gate.mjs`, `scripts/harness/scan-user-execution-plan-order.mjs`',
      nextDecision,
    );
    write(sequence.root, SPEC_PATH, afterPr2);
    commit(sequence.root, 'PR 2 implementation records the next Decision scope');
    git(sequence.root, ['switch', '-q', 'develop']);
    git(sequence.root, ['merge', '--no-ff', '-q', '-m', 'merge PR 2', 'feature-2']);
    const base = git(sequence.root, ['rev-parse', 'HEAD']);
    git(sequence.root, ['update-ref', 'refs/remotes/origin/develop', base]);
    git(sequence.root, ['switch', '-q', '-c', 'feature-3']);

    const parentSpec = readFileSync(path.join(sequence.root, SPEC_PATH), 'utf8');
    const ledgerPath = '.agents/loop-runs/user-execution-scenario.jsonl';
    const payload = formatCheckpointEvidence(LIVE_CONTRACT, 'gateImplementContinuation', {
      version: 1,
      form: 'gateImplementContinuation',
      priorPass: priorPassDigest(rawGateImplementPassEntries(parentSpec).at(-1)),
      sequencedArtifacts: ['scripts/harness/shared.mjs'],
      ancestorSha: base,
      taskPath: TASK_PATH,
      specPath: SPEC_PATH,
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [ledgerPath, SPEC_PATH, TASK_PATH].sort(),
    });
    if (!payload.ok) throw new Error(payload.error);
    write(
      sequence.root,
      ledgerPath,
      `${JSON.stringify(userScenarioRecord(TASK_ID, 'r20260829000003'))}\n`,
    );
    write(
      sequence.root,
      SPEC_PATH,
      `${parentSpec}### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30\n\n${CONTINUATION_STATUS_LINE}\n\n${payload.text}\n`,
    );
    commit(sequence.root, 'PR 3 continuation checkpoint with its own inventory');

    expect(findHistoryFindings(sequence.root, base)).toEqual([]);
  });

  it('admits legacy-v0 only before the unique v1 ancestry cutover (TC-06)', () => {
    const founding = repository();
    checkpoint(founding.root);
    write(founding.root, '.agents/rules/backlog-execution.md', LIVE_BACKLOG_RULE);
    commit(founding.root, 'introduce v1 contract after founding checkpoint');
    write(founding.root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(founding.root, 'implementation');
    expect(findHistoryFindings(founding.root, founding.base)).toEqual([]);

    const sequenced = repository();
    write(sequenced.root, TASK_PATH, taskText());
    write(
      sequenced.root,
      SPEC_PATH,
      specText().replace(
        '## Evidence Log',
        '## Architecture Review\n\n### Decision\n\n**Continuation artifacts:** `scripts/harness/gate.mjs`\n\n## Evidence Log',
      ),
    );
    commit(sequenced.root, 'legacy founding checkpoint');
    git(sequenced.root, ['switch', '-q', 'develop']);
    git(sequenced.root, ['merge', '--no-ff', '-q', '-m', 'merge legacy PR 1', 'feature']);
    const precedingMerge = git(sequenced.root, ['rev-parse', 'HEAD']);
    write(sequenced.root, '.agents/rules/backlog-execution.md', LIVE_BACKLOG_RULE);
    const sequencedBase = commit(sequenced.root, 'v1 cutover');
    git(sequenced.root, ['update-ref', 'refs/remotes/origin/develop', sequencedBase]);
    git(sequenced.root, ['switch', '-q', '-c', 'feature-2']);
    const parentSpec = readFileSync(path.join(sequenced.root, SPEC_PATH), 'utf8');
    const continuationPayload = formatCheckpointEvidence(
      LIVE_CONTRACT,
      'gateImplementContinuation',
      {
        version: 1,
        form: 'gateImplementContinuation',
        priorPass: priorPassDigest(rawGateImplementPassEntries(parentSpec).at(-1)),
        sequencedArtifacts: ['scripts/harness/gate.mjs'],
        ancestorSha: precedingMerge,
        taskPath: TASK_PATH,
        specPath: SPEC_PATH,
        plan: { outcome: 'not-applicable', count: 0 },
        worktreePaths: [SPEC_PATH, TASK_PATH].sort(),
      },
    );
    if (!continuationPayload.ok) throw new Error(continuationPayload.error);
    write(
      sequenced.root,
      SPEC_PATH,
      `${parentSpec}### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29\n\n${CONTINUATION_STATUS_LINE}\n\n${continuationPayload.text}\n`,
    );
    commit(sequenced.root, 'v1 continuation after legacy founding checkpoint');
    expect(findHistoryFindings(sequenced.root, sequencedBase)).toEqual([]);

    const postCutover = repository({ withContract: true });
    checkpoint(postCutover.root);
    expect(messages(findHistoryFindings(postCutover.root, postCutover.base))).toMatch(
      /legacy-v0.*not ancestry-eligible.*v1 cutover/,
    );

    const removed = repository({ withContract: true });
    write(removed.root, '.agents/rules/backlog-execution.md', '# removed\n');
    commit(removed.root, 'remove v1 contract');
    expect(messages(findHistoryFindings(removed.root, removed.base))).toMatch(
      /contract is missing or invalid after the v1 cutover/,
    );

    write(removed.root, '.agents/rules/backlog-execution.md', LIVE_BACKLOG_RULE);
    commit(removed.root, 'reintroduce a second v1 contract cutover');
    expect(messages(findHistoryFindings(removed.root, removed.base))).toMatch(
      /cutover is ambiguous/,
    );

    const invalidIntroduction = repository();
    write(
      invalidIntroduction.root,
      '.agents/rules/backlog-execution.md',
      '<!-- checkpoint-evidence-contract:v1:start -->\n```json\n{}\n```\n<!-- checkpoint-evidence-contract:v1:end -->\n',
    );
    git(invalidIntroduction.root, ['add', '-A']);
    expect(
      messages(findStagedFindings(invalidIntroduction.root, invalidIntroduction.base)),
    ).toMatch(/staged checkpoint evidence contract is unreadable/);
  });

  it('rejects a byte-identical legacy entry removed and reappended after cutover', () => {
    const fixture = repository();
    checkpoint(fixture.root);
    const legacySpec = readFileSync(path.join(fixture.root, SPEC_PATH), 'utf8');
    write(fixture.root, '.agents/rules/backlog-execution.md', LIVE_BACKLOG_RULE);
    const cutover = commit(fixture.root, 'introduce v1 contract');

    write(
      fixture.root,
      SPEC_PATH,
      legacySpec.replace(/### \[GATE-IMPLEMENT\][\s\S]*$/, 'GATE evidence temporarily removed.\n'),
    );
    commit(fixture.root, 'remove legacy checkpoint occurrence');
    write(fixture.root, SPEC_PATH, legacySpec);
    commit(fixture.root, 'reappend byte-identical legacy checkpoint occurrence');

    expect(messages(findHistoryFindings(fixture.root, cutover))).toMatch(
      /legacy-v0.*(?:introduction|occurrence).*ancestry/i,
    );
  });

  it('treats pathless commits consistently before and after a checkpoint', () => {
    const beforeOnly = repository();
    expect(findStagedFindings(beforeOnly.root, beforeOnly.base)).toEqual([]);
    git(beforeOnly.root, ['commit', '--allow-empty', '-m', 'pathless predecessor']);
    expect(findHistoryFindings(beforeOnly.root, beforeOnly.base)).toEqual([]);

    const around = repository();
    git(around.root, ['commit', '--allow-empty', '-m', 'pathless before checkpoint']);
    checkpoint(around.root);
    git(around.root, ['commit', '--allow-empty', '-m', 'pathless after checkpoint']);
    expect(findHistoryFindings(around.root, around.base)).toEqual([]);
  });

  it('accepts a not-applicable checkpoint before implementation', () => {
    const { root, base } = repository();
    checkpoint(root);
    write(root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(root, 'implementation');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('reports the exact traversed commit count and resets it on a second run', () => {
    const { root, base } = repository();
    checkpoint(root);
    write(root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(root, 'implementation');

    findHistoryFindings(root, base);
    expect(readExaminedPlanOrderCount(root, base)).toBe(2);
    findHistoryFindings(root, base);
    expect(readExaminedPlanOrderCount(root, base)).toBe(2);
  });

  it('does not count the synthetic merge of a valid branch as a second checkpoint (HARNESS-129)', () => {
    // CI checks out refs/pull/N/merge — the branch merged onto the base — and a merge commit's `^`
    // is its first parent, so its diff against the base is the whole branch, checkpoint transition
    // included. Evaluated at that merge, the scan must judge the branch's commits and nothing more.
    const { root, base } = repository();
    checkpoint(root);
    write(root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(root, 'implementation');
    const tip = git(root, ['rev-parse', 'HEAD']);

    git(root, ['switch', '-q', 'develop']);
    git(root, [
      'merge',
      '--no-ff',
      '-q',
      '-m',
      'Merge feature into develop (refs/pull/N/merge)',
      tip,
    ]);
    expect(git(root, ['rev-parse', 'HEAD^1'])).toBe(base);
    expect(git(root, ['rev-parse', 'HEAD^2'])).toBe(tip);

    // HEAD-spelling independence: the merge of the tip onto the base judges exactly as the tip.
    const atMerge = findHistoryFindings(root, base);
    const examinedAtMerge = readExaminedPlanOrderCount(root, base);
    git(root, ['switch', '-q', 'feature']);
    expect(atMerge).toEqual(findHistoryFindings(root, base));
    expect(atMerge).toEqual([]);
    expect(examinedAtMerge).toBe(readExaminedPlanOrderCount(root, base));
    expect(examinedAtMerge).toBe(2);
  });

  it('judges a promotion merge of develop into main as an empty topic range (HARNESS-129)', () => {
    // main holds only --no-ff promotion merges of earlier develop states; then develop is merged
    // into main and HEAD is that merge, base = develop's tip (the release-grade job's shape). Every
    // one of those merges diffs as a whole promotion against its first parent, so today they all
    // read as topic commits — and the checkpoint transitions inside them as candidates.
    const { root } = repository();
    write(root, 'packages/x/src/a.ts', 'export const a = 1;\n');
    commit(root, 'first develop step');
    checkpoint(root);
    write(root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(root, 'implementation');
    const developTip = git(root, ['rev-parse', 'HEAD']);
    git(root, ['update-ref', 'refs/remotes/origin/develop', developTip]);
    git(root, ['switch', '-q', '-c', 'main', git(root, ['rev-list', '--max-parents=0', 'HEAD'])]);
    git(root, [
      'merge',
      '--no-ff',
      '-q',
      '-m',
      'Merge pull request #1 from develop (earlier)',
      `${developTip}~2`,
    ]);
    git(root, [
      'merge',
      '--no-ff',
      '-q',
      '-m',
      'Merge pull request #2 from develop (promotion)',
      developTip,
    ]);
    expect(git(root, ['rev-list', '--count', `${developTip}..HEAD`])).not.toBe('0');

    expect(findHistoryFindings(root, developTip)).toEqual([]);
    expect(readExaminedPlanOrderCount(root, developTip)).toBe(0);
  });

  it('still judges the branch at its own tip, and still refuses two real checkpoints (HARNESS-129 controls)', () => {
    const branch = repository();
    checkpoint(branch.root);
    write(branch.root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(branch.root, 'implementation');
    expect(findHistoryFindings(branch.root, branch.base)).toEqual([]);

    // Two genuine checkpoint commits on one branch are two candidates — the ambiguity refusal
    // must survive the merge exclusion, or the flag silenced more than the merge.
    const twice = repository();
    checkpoint(twice.root);
    git(twice.root, ['rm', '-q', '-r', '.agents']);
    commit(twice.root, 'retract the pair');
    checkpoint(twice.root);
    expect(messages(findHistoryFindings(twice.root, twice.base))).toMatch(
      /multiple planning checkpoint candidates/,
    );
  });

  it('accepts a back-merge of an advanced base before the checkpoint (HARNESS-129 control)', () => {
    // The base moves on with an implementation path; the branch merges it in BEFORE its own
    // checkpoint. The merge's first-parent diff is the base's content, which is not the branch's
    // work — a false refusal on the branch tip today, fixed by the same exclusion. This is the
    // case that proves the decision is about attribution, not about CI's checkout.
    const { root } = repository();
    git(root, ['switch', '-q', 'develop']);
    write(root, 'packages/x/src/d.ts', 'export const d = 1;\n');
    commit(root, 'develop moves on (#2)');
    const advanced = git(root, ['rev-parse', 'HEAD']);
    git(root, ['update-ref', 'refs/remotes/origin/develop', advanced]);
    git(root, ['switch', '-q', 'feature']);
    git(root, ['commit', '--allow-empty', '-m', 'pathless start']);
    git(root, ['merge', '--no-ff', '-q', '-m', 'merge develop into feature', advanced]);
    checkpoint(root);
    write(root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(root, 'implementation');

    // The base is what CI resolves for a branch that merged develop in: develop's tip.
    expect(findHistoryFindings(root, advanced)).toEqual([]);
  });

  it('accepts a continuation checkpoint on a pair already in-progress at the base (HARNESS-131)', () => {
    const { root, base } = sequencedRepository();
    continuation(root);
    write(root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(root, 'implementation (PR 2)');
    expect(findHistoryFindings(root, base)).toEqual([]);
    expect(readExaminedPlanOrderCount(root, base)).toBe(2);
  });

  it('keeps refusing around a continuation: implementation before it, two of them, and a first-form entry (HARNESS-131)', () => {
    const early = sequencedRepository();
    write(early.root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(early.root, 'implementation before the continuation');
    continuation(early.root);
    // The continuation IS the checkpoint; what precedes it is refused as such.
    expect(messages(findHistoryFindings(early.root, early.base))).toMatch(
      /implementation or invalid-lifecycle path\(s\) changed before the planning checkpoint/,
    );

    const twice = sequencedRepository();
    continuation(twice.root);
    write(
      twice.root,
      SPEC_PATH,
      continuationSpecText() +
        continuationSpecText().slice(
          continuationSpecText().indexOf('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-28'),
        ),
    );
    commit(twice.root, 'a second continuation');
    expect(messages(findHistoryFindings(twice.root, twice.base))).toMatch(
      /multiple planning checkpoint candidates/,
    );

    // A second entry in the FIRST form on an in-progress pair is not a continuation.
    const firstForm = sequencedRepository();
    continuation(firstForm.root, { statusLine: '**Status upgrade:** approved → in-progress' });
    write(firstForm.root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(firstForm.root, 'implementation');
    expect(messages(findHistoryFindings(firstForm.root, firstForm.base))).toMatch(
      /implementation exists with no planning checkpoint/,
    );

    // A continuation whose Task changes the PLAN signal re-plans the outcome; the prior PASS is
    // bound to another signal, so it is not a continuation.
    const replanned = sequencedRepository();
    write(replanned.root, TASK_PATH, taskText({ outcome: 'automatable', stage1: true }));
    write(
      replanned.root,
      SPEC_PATH,
      continuationSpecText({ outcome: 'automatable', firstOutcome: 'not-applicable' }),
    );
    commit(replanned.root, 'continuation with a re-planned outcome');
    write(replanned.root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(replanned.root, 'implementation');
    expect(messages(findHistoryFindings(replanned.root, replanned.base))).toMatch(
      /no planning checkpoint/,
    );
  });

  it('refuses a FIRST checkpoint whose sole entry is in continuation form (HARNESS-131)', () => {
    // The pair was never in-progress; a continuation status line (copied from a sequenced spec)
    // is not a first checkpoint, symmetric to the first-form entry refused on an in-progress pair.
    const { root, base } = repository();
    write(root, TASK_PATH, taskText());
    write(root, SPEC_PATH, specText().replace(FIRST_STATUS_LINE, CONTINUATION_STATUS_LINE));
    commit(root, 'first checkpoint written in continuation form');
    write(root, 'scripts/harness/change.mjs', 'implementation\n');
    commit(root, 'implementation');
    expect(messages(findHistoryFindings(root, base))).toMatch(/no planning checkpoint/);
  });

  it('mirrors the continuation on the staged path (HARNESS-131)', () => {
    const without = sequencedRepository();
    write(without.root, 'scripts/harness/change.mjs', 'implementation\n');
    git(without.root, ['add', '-A']);
    expect(messages(findStagedFindings(without.root, without.base))).toMatch(
      /staged implementation has no planning checkpoint ancestor/,
    );

    // The continuation itself staged — the shape the pre-commit hook judges.
    const proposal = sequencedRepository();
    write(proposal.root, SPEC_PATH, continuationSpecText());
    git(proposal.root, ['add', '-A']);
    expect(findStagedFindings(proposal.root, proposal.base)).toEqual([]);

    const withIt = sequencedRepository();
    continuation(withIt.root);
    write(withIt.root, 'scripts/harness/change.mjs', 'implementation\n');
    git(withIt.root, ['add', '-A']);
    expect(findStagedFindings(withIt.root, withIt.base)).toEqual([]);

    // A staged first-form entry on an in-progress pair is discovered as a candidate and fails the
    // form; the refusal names both forms it judged.
    const firstForm = sequencedRepository();
    write(
      firstForm.root,
      SPEC_PATH,
      continuationSpecText({ statusLine: '**Status upgrade:** approved → in-progress' }),
    );
    git(firstForm.root, ['add', '-A']);
    expect(messages(findStagedFindings(firstForm.root, firstForm.base))).toMatch(
      /checkpoint is neither the first GATE-IMPLEMENT PASS .* nor one continuation PASS/,
    );
  });

  it('accepts the continuation status line the catalogue declares (HARNESS-131)', () => {
    const catalogue = readFileSync(
      path.resolve(import.meta.dirname, '../../..', '.agents/specs/gate-catalogue.md'),
      'utf8',
    );
    const section = catalogue.slice(
      catalogue.indexOf('### GATE-IMPLEMENT'),
      catalogue.indexOf('### GATE-VERIFY'),
    );
    expect(section).toContain(CONTINUATION_STATUS_LINE);
  });

  it('accepts applicable PLAN only with DONE-GATE-STAGE-1 PASS', () => {
    const { root, base } = repository();
    checkpoint(root, { outcome: 'automatable', stage1: true });

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('binds DONE-GATE-STAGE-1 to the declared complete scenario set', () => {
    const mutations = [
      (text) => text.replace(/### Scenario 1[\s\S]*?(?=### \[DONE-GATE-STAGE-1\])/, ''),
      (text) =>
        text.replace('SCENARIO DRAFTED: automatable | 1', 'SCENARIO DRAFTED: automatable | 2'),
      (text) => text.replace('- prerequisites: fixture repository initialized\n', ''),
      (text) => text.replace('- product surface: robota-cli\n', ''),
      (text) => text.replace('- surface rationale: shipped-entrypoint=robota\n', ''),
      (text) => text.replace('- command: `robota fixture`\n', ''),
      (text) => text.replace('- observable type: product-output\n', ''),
      (text) => text.replace('- expected observable: exit=0; output-contains=visible result\n', ''),
      (text) => text.replace('- observable rationale: source=product-process\n', ''),
      (text) => text.replace('- cleanup: none\n', ''),
      (text) => text.replace('- evidence: pending\n', ''),
      (text) => text.replace('- executability: agent-executable\n', ''),
      (text) =>
        text.replace(
          '**Status upgrade:** scenario drafted → scenario written',
          '**Status upgrade:** arbitrary → transition',
        ),
      (text) => text.replace('- Scenario 1 —', '- Scenario evidence —'),
      (text) =>
        text.replace(
          'guardian-observable-verdict=product-behavior',
          'guardian-observable-verdict=engineering-verification',
        ),
    ];

    for (const mutate of mutations) {
      const fixture = repository();
      write(fixture.root, TASK_PATH, mutate(taskText({ outcome: 'automatable', stage1: true })));
      write(fixture.root, SPEC_PATH, specText({ outcome: 'automatable' }));
      commit(fixture.root, 'incomplete or unbound Stage-1 evidence');

      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /DONE-GATE-STAGE-1|scenario|checkpoint|planning/i,
      );
    }
  });

  it('rejects engineering-only commands as user-execution product surfaces', async () => {
    for (const command of [
      'pnpm test',
      'pnpm build',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm harness:scan',
      'gh pr checks',
      'pnpm --filter @robota/core test',
      'pnpm -w test',
      'turbo test',
      'nx test',
      'make test',
      'robota --help && pnpm test',
      'robota --help; pnpm test',
      'robota --help || pnpm test',
      'robota --help $(pnpm test)',
      'robota --help & pnpm test',
      'robota --config <(pnpm test)',
      'robota --help `pnpm test`',
      '"" robota fixture',
    ]) {
      const fixture = repository();
      write(
        fixture.root,
        TASK_PATH,
        taskText({ outcome: 'automatable', stage1: true }).replaceAll('robota fixture', command),
      );
      write(fixture.root, SPEC_PATH, specText({ outcome: 'automatable' }));
      commit(fixture.root, 'engineering verification masquerading as user scenario');

      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /scenario|checkpoint|planning/i,
      );
      await yieldToEventLoop();
    }

    const fakeSurface = repository();
    write(
      fakeSurface.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', stage1: true }).replaceAll(
        'robota-cli',
        'imaginary-product',
      ),
    );
    write(fakeSurface.root, SPEC_PATH, specText({ outcome: 'automatable' }));
    commit(fakeSurface.root, 'arbitrary fake product surface');
    expect(messages(findHistoryFindings(fakeSurface.root, fakeSurface.base))).toMatch(
      /scenario|checkpoint|planning/i,
    );

    for (const invocation of [
      'node examples/demo.mjs && pnpm test',
      'node examples/../scripts/harness/run-all-scans.mjs',
      'node scratch/../scripts/harness/run-all-scans.mjs',
      'pnpm --dir examples/../scripts run scan',
      'node examples/${EXAMPLE_PATH}',
      'node "exa\\mples/demo.mjs"',
      'node --test examples/demo.mjs',
      'node --require scripts/harness/run-all-scans.mjs examples/demo.mjs',
      'node "" examples/demo.mjs',
      'robota --dir examples/demo run fixture',
      'pnpm test --dir examples/demo',
      'bash -C examples/demo',
      'pnpm --dir examples/demo run --',
      'pnpm --dir examples/demo run --if-present',
    ]) {
      const sdkChain = repository();
      write(
        sdkChain.root,
        TASK_PATH,
        taskText({ outcome: 'automatable', stage1: true })
          .replaceAll('surface=robota-cli', 'surface=public-sdk-example')
          .replace('product surface: robota-cli', 'product surface: public-sdk-example')
          .replaceAll('shipped-entrypoint=robota', 'shipped-interface=public-sdk-example')
          .replaceAll('observable-type=product-output', 'observable-type=sdk-result')
          .replace('observable type: product-output', 'observable type: sdk-result')
          .replaceAll('exit=0; output-contains=visible result', 'result=visible SDK value')
          .replaceAll('source=product-process', 'source=public-sdk-return')
          .replaceAll('robota fixture', invocation),
      );
      write(sdkChain.root, SPEC_PATH, specText({ outcome: 'automatable' }));
      commit(sdkChain.root, 'invalid public SDK invocation');
      expect(messages(findHistoryFindings(sdkChain.root, sdkChain.base))).toMatch(
        /scenario|checkpoint|planning/i,
      );
      await yieldToEventLoop();
    }

    for (const observable of [
      'unit tests pass',
      'unit test success',
      'build successful',
      'test suite is green',
      'repository text contains the new rule',
      'verification suite reports success',
      'source file contains the new rule',
    ]) {
      const testObservable = repository();
      write(
        testObservable.root,
        TASK_PATH,
        taskText({ outcome: 'automatable', stage1: true }).replaceAll(
          'exit=0; output-contains=visible result',
          observable,
        ),
      );
      write(testObservable.root, SPEC_PATH, specText({ outcome: 'automatable' }));
      commit(testObservable.root, 'engineering-only expected observable');
      expect(messages(findHistoryFindings(testObservable.root, testObservable.base))).toMatch(
        /scenario|checkpoint|planning/i,
      );
      await yieldToEventLoop();
    }
  }, 300_000);

  it('allows a controlled grep pipe over product command output', () => {
    const fixture = repository();
    write(
      fixture.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', stage1: true }).replaceAll(
        'robota fixture',
        'robota --help | grep Usage',
      ),
    );
    write(fixture.root, SPEC_PATH, specText({ outcome: 'automatable' }));
    commit(fixture.root, 'controlled product output assertion');

    expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);
  });

  it('parses quoted shell metacharacters and rejects unclosed quotes', () => {
    const safe = repository();
    write(
      safe.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', stage1: true }).replaceAll(
        'robota fixture',
        "robota ask 'A & B'",
      ),
    );
    write(safe.root, SPEC_PATH, specText({ outcome: 'automatable' }));
    commit(safe.root, 'quoted product argument');
    expect(findHistoryFindings(safe.root, safe.base)).toEqual([]);

    const broken = repository();
    write(
      broken.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', stage1: true }).replaceAll(
        'robota fixture',
        'robota "unterminated',
      ),
    );
    write(broken.root, SPEC_PATH, specText({ outcome: 'automatable' }));
    commit(broken.root, 'unclosed product argument');
    expect(messages(findHistoryFindings(broken.root, broken.base))).toMatch(
      /scenario|checkpoint|planning/i,
    );
  });

  it('accepts quoted SDK paths and supported leading Node options', () => {
    for (const invocation of [
      'node "./examples/demo.mjs"',
      'node --enable-source-maps "./examples/demo.mjs"',
      'tsx "./examples/demo.ts"',
      'pnpm exec tsx "./examples/demo.ts"',
      'pnpm --dir examples/demo run scenario.verify',
      "node \"./examples/demo.mjs\" '2*2' '$100' '{\"x\":1}'",
    ]) {
      const fixture = repository();
      const task = taskText({ outcome: 'automatable', stage1: true })
        .replaceAll('surface=robota-cli', 'surface=public-sdk-example')
        .replace('product surface: robota-cli', 'product surface: public-sdk-example')
        .replaceAll('shipped-entrypoint=robota', 'shipped-interface=public-sdk-example')
        .replaceAll('observable-type=product-output', 'observable-type=sdk-result')
        .replace('observable type: product-output', 'observable type: sdk-result')
        .replaceAll('exit=0; output-contains=visible result', 'result=visible SDK value')
        .replaceAll('source=product-process', 'source=public-sdk-return')
        .replaceAll('robota fixture', invocation);
      write(fixture.root, TASK_PATH, task);
      write(fixture.root, SPEC_PATH, specText({ outcome: 'automatable' }));
      commit(fixture.root, 'canonical quoted SDK invocation');
      expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);
    }
  });

  it('requires a literal canonical product-state file path', () => {
    const stateTask = (statePath) =>
      taskText({ outcome: 'automatable', stage1: true })
        .replaceAll('observable-type=product-output', 'observable-type=product-state-file')
        .replace('observable type: product-output', 'observable type: product-state-file')
        .replaceAll('exit=0; output-contains=visible result', 'change=updated')
        .replace(
          '- observable rationale: source=product-process',
          `- observable rationale: source=robota-state-artifact\n- product state path: ${statePath}`,
        )
        .replace(
          'observable-rationale=source=product-process;',
          `observable-rationale=source=robota-state-artifact; product-state-path=${statePath};`,
        );

    const valid = repository();
    write(valid.root, TASK_PATH, stateTask('.robota/state.json'));
    write(valid.root, SPEC_PATH, specText({ outcome: 'automatable' }));
    commit(valid.root, 'literal product-state file');
    expect(findHistoryFindings(valid.root, valid.base)).toEqual([]);

    for (const statePath of [
      '.robota/${STATE_PATH}',
      '.robota/',
      '.robota/*.json',
      '.robota/{one,two}.json',
      '.robota/../outside.json',
      '~/.robota/state.json',
    ]) {
      const invalid = repository();
      write(invalid.root, TASK_PATH, stateTask(statePath));
      write(invalid.root, SPEC_PATH, specText({ outcome: 'automatable' }));
      commit(invalid.root, 'dynamic or escaping product-state path');
      expect(messages(findHistoryFindings(invalid.root, invalid.base))).toMatch(
        /scenario|checkpoint|planning/i,
      );
    }
  });

  it('accepts one-character canonical observable values', () => {
    const tasks = [
      taskText({ outcome: 'automatable', stage1: true }).replaceAll(
        'exit=0; output-contains=visible result',
        'exit=0; output-contains=X',
      ),
      taskText({ outcome: 'automatable', browserAutomatable: true, stage1: true }).replaceAll(
        'visible=fixture control active in browser UI',
        'visible=Y',
      ),
      taskText({ outcome: 'automatable', stage1: true })
        .replaceAll('surface=robota-cli', 'surface=public-sdk-example')
        .replace('product surface: robota-cli', 'product surface: public-sdk-example')
        .replaceAll('shipped-entrypoint=robota', 'shipped-interface=public-sdk-example')
        .replaceAll('observable-type=product-output', 'observable-type=sdk-result')
        .replace('observable type: product-output', 'observable type: sdk-result')
        .replaceAll('exit=0; output-contains=visible result', 'result=Z')
        .replaceAll('source=product-process', 'source=public-sdk-return')
        .replaceAll('robota fixture', 'node examples/demo.mjs'),
    ];
    for (const task of tasks) {
      const fixture = repository();
      write(fixture.root, TASK_PATH, task);
      write(fixture.root, SPEC_PATH, specText({ outcome: 'automatable' }));
      commit(fixture.root, 'one-character product observable');
      expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);
    }
  });

  it('accepts an agent-executable browser scenario with canonical browser steps', () => {
    const fixture = repository();
    write(
      fixture.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', browserAutomatable: true, stage1: true }),
    );
    write(fixture.root, SPEC_PATH, specText({ outcome: 'automatable' }));
    commit(fixture.root, 'automatable browser product scenario');
    expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);
  });

  it('rejects multiline command continuation hidden after the canonical field line', () => {
    const fixture = repository();
    write(
      fixture.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', stage1: true })
        .replace('- command: `robota fixture`', '- command: `robota --help`\npnpm test')
        .replace('invocation=robota fixture', 'invocation=robota --help'),
    );
    write(fixture.root, SPEC_PATH, specText({ outcome: 'automatable' }));
    commit(fixture.root, 'multiline command continuation');

    expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
      /scenario|checkpoint|planning/i,
    );
  });

  it('binds PLAN outcome to specific per-scenario executability decisions', () => {
    const contradictions = [
      taskText({ outcome: 'automatable', stage1: true }).replace(
        'executability: agent-executable',
        'executability: manual-only: browser security-key prompt requires physical interaction',
      ),
      taskText({ outcome: 'manual', stage1: true }).replace(
        'executability: manual-only: browser security-key prompt requires physical device interaction',
        'executability: agent-executable',
      ),
      taskText({ outcome: 'manual', stage1: true })
        .replace(
          'manual-only: browser security-key prompt requires physical device interaction',
          'manual-only: automation is unavailable for this interaction',
        )
        .replace(/- automation barrier:[\s\S]*?(?=- expected observable:)/, ''),
    ];

    for (const task of contradictions) {
      const fixture = repository();
      write(fixture.root, TASK_PATH, task);
      const outcome = task.includes('SCENARIO DRAFTED: manual') ? 'manual' : 'automatable';
      write(fixture.root, SPEC_PATH, specText({ outcome }));
      commit(fixture.root, 'contradictory or vague executability decision');

      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /scenario|checkpoint|planning/i,
      );
    }
  });

  it('binds a manual browser scenario to UI steps rather than an unrelated command', () => {
    const fixture = repository();
    const manualInvocation = 'open Robota browser UI and activate the fixture control';
    write(
      fixture.root,
      TASK_PATH,
      taskText({ outcome: 'manual', stage1: true })
        .replace('- UI steps:', '- command: `robota unrelated`\n- UI steps:')
        .replace(`invocation=${manualInvocation}`, 'invocation=robota unrelated'),
    );
    write(fixture.root, SPEC_PATH, specText({ outcome: 'manual' }));
    commit(fixture.root, 'manual scenario bound to unrelated command');

    expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
      /scenario|checkpoint|planning/i,
    );
  });

  it('accepts a manual-only TUI scenario with a canonical start command and UI steps', () => {
    const fixture = repository();
    const browserInvocation = 'open Robota browser UI and activate the fixture control';
    const task = taskText({ outcome: 'manual', stage1: true })
      .replaceAll('surface=robota-browser-ui', 'surface=robota-tui')
      .replace('product surface: robota-browser-ui', 'product surface: robota-tui')
      .replaceAll('shipped-interface=robota-browser-ui', 'shipped-entrypoint=robota')
      .replace(
        `- UI steps: ${browserInvocation}`,
        `- command: \`robota interactive\`\n- UI steps: ${browserInvocation}`,
      )
      .replace(
        `invocation=${browserInvocation}`,
        `invocation=robota interactive; ui-steps=${browserInvocation}`,
      );
    write(fixture.root, TASK_PATH, task);
    write(fixture.root, SPEC_PATH, specText({ outcome: 'manual' }));
    commit(fixture.root, 'manual TUI scenario');

    expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);

    const stale = repository();
    write(
      stale.root,
      TASK_PATH,
      task.replace(
        `- UI steps: ${browserInvocation}`,
        '- UI steps: choose a different interactive control',
      ),
    );
    write(stale.root, SPEC_PATH, specText({ outcome: 'manual' }));
    commit(stale.root, 'stale manual TUI Stage binding');
    expect(messages(findHistoryFindings(stale.root, stale.base))).toMatch(
      /scenario|checkpoint|planning|DONE-GATE-STAGE-1/i,
    );
  });

  it('requires exactly one nonempty value for every canonical scenario field', () => {
    const automaticMutations = [
      (text) => text.replace('- command:', '- command: `robota fixture`\n- command:'),
      (text) =>
        text.replace('- product surface:', '- product surface: robota-cli\n- product surface:'),
      (text) =>
        text.replace(
          '- expected observable:',
          '- expected observable: exit=0; output-contains=visible result\n- expected observable:',
        ),
      (text) => text.replace('- evidence:', '- evidence: duplicate\n- evidence:'),
      (text) => text.replaceAll('exit=0; output-contains=visible result', ''),
    ];
    for (const mutate of automaticMutations) {
      const fixture = repository();
      write(fixture.root, TASK_PATH, mutate(taskText({ outcome: 'automatable', stage1: true })));
      write(fixture.root, SPEC_PATH, specText({ outcome: 'automatable' }));
      commit(fixture.root, 'duplicate or empty canonical scenario field');
      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /scenario|checkpoint|planning/i,
      );
    }

    const manual = repository();
    write(
      manual.root,
      TASK_PATH,
      taskText({ outcome: 'manual', stage1: true }).replace(
        '- automation barrier:',
        '- automation barrier: physical-device\n- automation barrier:',
      ),
    );
    write(manual.root, SPEC_PATH, specText({ outcome: 'manual' }));
    commit(manual.root, 'duplicate manual barrier field');
    expect(messages(findHistoryFindings(manual.root, manual.base))).toMatch(
      /scenario|checkpoint|planning/i,
    );
  });

  it('does not mistake active-to-done archival deletions for a second checkpoint', () => {
    const { root, base } = repository();
    checkpoint(root);
    mkdirSync(path.join(root, '.agents/tasks/completed'), { recursive: true });
    mkdirSync(path.join(root, '.agents/spec-docs/done'), { recursive: true });
    git(root, ['mv', TASK_PATH, `.agents/tasks/completed/${TASK_ID}.md`]);
    git(root, ['mv', SPEC_PATH, `.agents/spec-docs/done/${TASK_ID}.md`]);
    commit(root, 'complete work unit');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('does not mistake a later Task plus active-spec evidence update for a second checkpoint', () => {
    const { root, base } = repository();
    checkpoint(root);
    write(root, TASK_PATH, `${taskText()}\n## Evidence\n\nverified\n`);
    write(root, SPEC_PATH, `${specText()}\n### [GATE-VERIFY] — ✅ PASS | 2026-08-25\n`);
    commit(root, 'verification evidence');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('rejects applicable PLAN without DONE-GATE-STAGE-1', () => {
    const { root, base } = repository();
    checkpoint(root, { outcome: 'automatable' });

    expect(messages(findHistoryFindings(root, base))).toMatch(/DONE-GATE-STAGE-1/);
  });

  it('rejects implementation committed before a later checkpoint even when the Task existed in base', () => {
    const { root, base } = repository({ taskInBase: true });
    write(root, 'packages/example/src.ts', 'implementation\n');
    commit(root, 'implementation first');
    checkpoint(root);

    expect(messages(findHistoryFindings(root, base))).toMatch(/before.*checkpoint/i);
  });

  it('treats arbitrary Markdown as implementation before the checkpoint', () => {
    const { root, base } = repository();
    write(root, '.agents/rules/example.md', '# implementation in Markdown\n');
    commit(root, 'rule implementation first');
    checkpoint(root);

    expect(messages(findHistoryFindings(root, base))).toContain('.agents/rules/example.md');
  });

  it('rejects a subject-bound verdict that names another Task', () => {
    const { root, base } = repository();
    write(root, TASK_PATH, taskText({ subject: 'HARNESS-901-other' }));
    write(root, SPEC_PATH, specText());
    commit(root, 'mismatched checkpoint');

    expect(messages(findHistoryFindings(root, base))).toMatch(/subject|binding/i);
  });

  it('rejects stale active-pair tokens that did not transition in the candidate commit', () => {
    const seeded = repository();
    git(seeded.root, ['switch', 'develop']);
    writeCheckpoint(seeded.root);
    const base = commit(seeded.root, 'stale active pair in base');
    git(seeded.root, ['update-ref', 'refs/remotes/origin/develop', base]);
    git(seeded.root, ['switch', '-C', 'feature', base]);
    write(seeded.root, TASK_PATH, `${taskText()}\nmeaningless change\n`);
    write(seeded.root, SPEC_PATH, `${specText()}\nmeaningless change\n`);
    commit(seeded.root, 'touch stale pair');

    expect(messages(findHistoryFindings(seeded.root, base))).toMatch(/checkpoint|transition/i);
  });

  it('rejects PLAN and gate tokens that exist only in fenced examples', () => {
    const { root, base } = repository();
    write(
      root,
      TASK_PATH,
      [
        '---',
        'status: in-progress',
        '---',
        '',
        '# HARNESS-900: fixture',
        '',
        '## User Execution Test Scenarios',
        '',
        'No author verdict is recorded here.',
        '',
        '```text',
        'SCENARIO DRAFTED: not-applicable | 0',
        'Not applicable because this is only an example with enough words to fool a token scan.',
        '```',
      ].join('\n'),
    );
    write(root, SPEC_PATH, specText());
    commit(root, 'fenced token checkpoint');

    expect(messages(findHistoryFindings(root, base))).toMatch(
      /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
    );
  });

  it('rejects section headings and verdicts whose entire section is fenced or indented code', () => {
    const fenced = repository();
    write(
      fenced.root,
      TASK_PATH,
      [
        '---',
        'status: in-progress',
        '---',
        '',
        '# HARNESS-900: fixture',
        '',
        '````md',
        '## User Execution Test Scenarios',
        '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
        'Not applicable because fenced text is not lifecycle evidence even when it is long enough.',
        '```',
        'still fenced',
        '````',
      ].join('\n'),
    );
    write(fenced.root, SPEC_PATH, specText());
    commit(fenced.root, 'fenced section heading');
    expect(messages(findHistoryFindings(fenced.root, fenced.base))).toMatch(
      /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
    );

    const indented = repository();
    write(indented.root, TASK_PATH, taskText());
    write(
      indented.root,
      SPEC_PATH,
      [
        '---',
        'status: in-progress',
        '---',
        '',
        `# ${TASK_ID}`,
        '',
        `    ## Tasks`,
        `    - [x] \`.agents/tasks/${TASK_ID}.md\``,
        '    ## Evidence Log',
        '    ### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25',
      ].join('\n'),
    );
    commit(indented.root, 'indented code contract');
    expect(messages(findHistoryFindings(indented.root, indented.base))).toMatch(
      /checkpoint|transition|binding/i,
    );
  });

  it('rejects lifecycle evidence that exists only inside HTML comments or raw HTML blocks', () => {
    for (const wrapper of [(body) => `<!--\n${body}\n-->`, (body) => `<div>\n${body}\n</div>`]) {
      const fixture = repository();
      write(
        fixture.root,
        TASK_PATH,
        taskText().replace(
          /## User Execution Test Scenarios[\s\S]*$/,
          wrapper(
            [
              '## User Execution Test Scenarios',
              '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
              'Not applicable because invisible HTML content cannot be lifecycle evidence.',
            ].join('\n'),
          ),
        ),
      );
      write(fixture.root, SPEC_PATH, specText());
      commit(fixture.root, 'invisible HTML evidence');
      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
      );
    }
  });

  it('keeps real evidence after literal HTML-comment markers in fenced and inline code', () => {
    for (const literal of ['```text\n<!-- literal fixture marker\n```', 'Literal `<!--` marker.']) {
      const fixture = repository();
      write(
        fixture.root,
        TASK_PATH,
        taskText().replace(
          '## User Execution Test Scenarios',
          `${literal}\n\n## User Execution Test Scenarios`,
        ),
      );
      write(fixture.root, SPEC_PATH, specText());
      commit(fixture.root, 'literal HTML comment marker before real evidence');

      expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);
    }
  });

  it('treats odd-backslash HTML comment openers as literal and even-backslash openers as comments', () => {
    const literal = repository();
    write(
      literal.root,
      TASK_PATH,
      taskText().replace(
        '## User Execution Test Scenarios',
        '\\<!-- escaped literal opener\n\n## User Execution Test Scenarios',
      ),
    );
    write(literal.root, SPEC_PATH, specText());
    commit(literal.root, 'escaped literal comment opener');
    expect(findHistoryFindings(literal.root, literal.base)).toEqual([]);

    const comment = repository();
    write(
      comment.root,
      TASK_PATH,
      taskText().replace(
        /## User Execution Test Scenarios[\s\S]*$/,
        [
          '\\\\<!-- even-backslash real comment opener',
          '## User Execution Test Scenarios',
          '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
          'Not applicable because this comment-hidden text is long enough to mimic evidence.',
          '-->',
        ].join('\n'),
      ),
    );
    write(comment.root, SPEC_PATH, specText());
    commit(comment.root, 'even-backslash real comment opener');
    expect(messages(findHistoryFindings(comment.root, comment.base))).toMatch(
      /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
    );
  });

  it('ends a type-1 raw HTML block when its closing tag is on the opening line', () => {
    const { root, base } = repository();
    write(
      root,
      TASK_PATH,
      taskText().replace(
        '## User Execution Test Scenarios',
        '<script </script>\n\n## User Execution Test Scenarios',
      ),
    );
    write(root, SPEC_PATH, specText());
    commit(root, 'same-line type-one raw HTML block');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('keeps a type-7 inline HTML tag inside an open paragraph', () => {
    const { root, base } = repository();
    write(
      root,
      TASK_PATH,
      taskText().replace(
        '## User Execution Test Scenarios',
        ['Paragraph before inline HTML.', '<span>', '## User Execution Test Scenarios'].join('\n'),
      ),
    );
    write(root, SPEC_PATH, specText());
    commit(root, 'type-seven inline HTML in open paragraph');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('keeps indented paragraph continuation as a concrete N/A reason', () => {
    const { root, base } = repository();
    write(
      root,
      TASK_PATH,
      taskText().replace(
        'Not applicable because this fixture changes repository lifecycle governance only and exposes no product surface.',
        [
          'Not applicable:',
          '    because this paragraph continuation records a concrete and sufficiently detailed lifecycle-only reason.',
        ].join('\n'),
      ),
    );
    write(root, SPEC_PATH, specText());
    commit(root, 'indented paragraph continuation reason');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('does not promote an indented paragraph continuation into a structural heading', () => {
    const { root, base } = repository();
    write(
      root,
      TASK_PATH,
      [
        '---',
        'status: in-progress',
        '---',
        '',
        '# HARNESS-900: fixture',
        '',
        'Paragraph before fake structure.',
        '    ## User Execution Test Scenarios',
        '    **Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
        '    Not applicable because this indented text is not a structural section.',
      ].join('\n'),
    );
    write(root, SPEC_PATH, specText());
    commit(root, 'indented fake lifecycle heading');

    expect(messages(findHistoryFindings(root, base))).toMatch(
      /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
    );
  });

  it('accepts optional closing hashes but keeps an attached hash as heading content', () => {
    const valid = repository();
    write(
      valid.root,
      TASK_PATH,
      taskText().replace('## User Execution Test Scenarios', '## User Execution Test Scenarios ##'),
    );
    write(
      valid.root,
      SPEC_PATH,
      specText()
        .replace('## Tasks', '## Tasks ##')
        .replace('## Evidence Log', '## Evidence Log ##'),
    );
    commit(valid.root, 'optional ATX closing hashes');
    expect(findHistoryFindings(valid.root, valid.base)).toEqual([]);

    const attached = repository();
    write(
      attached.root,
      TASK_PATH,
      taskText().replace('## User Execution Test Scenarios', '## User Execution Test Scenarios#'),
    );
    write(attached.root, SPEC_PATH, specText());
    commit(attached.root, 'attached hash remains heading content');
    expect(messages(findHistoryFindings(attached.root, attached.base))).toMatch(
      /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
    );
  });

  it('accepts a 1–3-space Task H1 but rejects a 4-space indented-code lookalike', () => {
    const valid = repository();
    write(
      valid.root,
      TASK_PATH,
      taskText().replace('# HARNESS-900: fixture', '   # HARNESS-900: fixture'),
    );
    write(valid.root, SPEC_PATH, specText());
    commit(valid.root, 'three-space structural Task heading');
    expect(findHistoryFindings(valid.root, valid.base)).toEqual([]);

    const code = repository();
    write(
      code.root,
      TASK_PATH,
      taskText().replace('# HARNESS-900: fixture', '    # HARNESS-900: fixture'),
    );
    write(code.root, SPEC_PATH, specText());
    commit(code.root, 'four-space indented Task heading lookalike');
    expect(messages(findHistoryFindings(code.root, code.base))).toMatch(/subject|binding/i);
  });

  it('accepts a 1–3-space GATE H3 but rejects a 4-space indented-code lookalike', () => {
    const valid = repository();
    write(valid.root, TASK_PATH, taskText());
    write(
      valid.root,
      SPEC_PATH,
      specText().replace(
        '### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25',
        '   ### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25',
      ),
    );
    commit(valid.root, 'three-space structural gate heading');
    expect(findHistoryFindings(valid.root, valid.base)).toEqual([]);

    const code = repository();
    write(code.root, TASK_PATH, taskText());
    write(
      code.root,
      SPEC_PATH,
      specText().replace(
        '### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25',
        '    ### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25',
      ),
    );
    commit(code.root, 'four-space indented gate heading lookalike');
    expect(messages(findHistoryFindings(code.root, code.base))).toMatch(/checkpoint|transition/i);
  });

  it('rejects PASS-prefixed non-verdicts for GATE-IMPLEMENT and Stage 1', () => {
    const gate = repository();
    write(gate.root, TASK_PATH, taskText());
    write(gate.root, SPEC_PATH, specText().replace('✅ PASS |', '✅ PASS-FAIL |'));
    commit(gate.root, 'non-verdict gate heading');
    expect(messages(findHistoryFindings(gate.root, gate.base))).toMatch(/checkpoint|transition/i);

    const stage = repository();
    write(
      stage.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', stage1: true }).replace(
        '[DONE-GATE-STAGE-1] — ✅ PASS |',
        '[DONE-GATE-STAGE-1] — ✅ PASS ❌ FAIL |',
      ),
    );
    write(stage.root, SPEC_PATH, specText());
    commit(stage.root, 'non-verdict Stage-1 heading');
    expect(messages(findHistoryFindings(stage.root, stage.base))).toMatch(
      /DONE-GATE-STAGE-1|checkpoint|planning/i,
    );

    const gatePipe = repository();
    write(gatePipe.root, TASK_PATH, taskText());
    write(gatePipe.root, SPEC_PATH, specText().replace('✅ PASS |', '✅ PASS|FAIL'));
    commit(gatePipe.root, 'zero-space pipe gate non-verdict');
    expect(messages(findHistoryFindings(gatePipe.root, gatePipe.base))).toMatch(
      /checkpoint|transition/i,
    );

    const stagePipe = repository();
    write(
      stagePipe.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', stage1: true }).replace(
        '[DONE-GATE-STAGE-1] — ✅ PASS |',
        '[DONE-GATE-STAGE-1] — ✅ PASS|FAIL',
      ),
    );
    write(stagePipe.root, SPEC_PATH, specText());
    commit(stagePipe.root, 'zero-space pipe Stage-1 non-verdict');
    expect(messages(findHistoryFindings(stagePipe.root, stagePipe.base))).toMatch(
      /DONE-GATE-STAGE-1|checkpoint|planning/i,
    );
  });

  it('requires a real calendar date on GATE-IMPLEMENT and Stage-1 PASS entries', () => {
    for (const suffix of ['', ' | ', ' | 2026-02-30']) {
      const gate = repository();
      write(gate.root, TASK_PATH, taskText());
      write(gate.root, SPEC_PATH, specText().replace('✅ PASS | 2026-08-25', `✅ PASS${suffix}`));
      commit(gate.root, 'undated or invalid-date gate entry');
      expect(messages(findHistoryFindings(gate.root, gate.base))).toMatch(/checkpoint|transition/i);

      const stage = repository();
      write(
        stage.root,
        TASK_PATH,
        taskText({ outcome: 'automatable', stage1: true }).replace(
          '[DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-25',
          `[DONE-GATE-STAGE-1] — ✅ PASS${suffix}`,
        ),
      );
      write(stage.root, SPEC_PATH, specText());
      commit(stage.root, 'undated or invalid-date Stage-1 entry');
      expect(messages(findHistoryFindings(stage.root, stage.base))).toMatch(
        /DONE-GATE-STAGE-1|checkpoint|planning/i,
      );
    }
  });

  it('rejects dated PASS headings with partial entry bodies', () => {
    const gate = repository();
    write(gate.root, TASK_PATH, taskText());
    write(
      gate.root,
      SPEC_PATH,
      specText().replace(/\n- Task artifact:[\s\S]*?- Whole-worktree precondition:[^\n]*\n/, '\n'),
    );
    commit(gate.root, 'partial GATE-IMPLEMENT entry');
    expect(messages(findHistoryFindings(gate.root, gate.base))).toMatch(/checkpoint|transition/i);

    const stage = repository();
    write(
      stage.root,
      TASK_PATH,
      taskText({ outcome: 'automatable', stage1: true }).replace(
        /\n\*\*Status upgrade:\*\* scenario drafted → scenario written[\s\S]*$/,
        '',
      ),
    );
    write(stage.root, SPEC_PATH, specText());
    commit(stage.root, 'partial Stage-1 entry');
    expect(messages(findHistoryFindings(stage.root, stage.base))).toMatch(
      /DONE-GATE-STAGE-1|checkpoint|planning/i,
    );
  });

  it('binds GATE-IMPLEMENT evidence to the exact Task and actual PLAN outcome/count', () => {
    for (const mutate of [
      (text) => {
        const at = text.indexOf('## Evidence Log');
        return `${text.slice(0, at)}${text.slice(at).replaceAll(TASK_ID, 'HARNESS-901-other')}`;
      },
      (text) =>
        text.replace('SCENARIO DRAFTED: not-applicable | 0', 'SCENARIO DRAFTED: automatable | 0'),
      (text) =>
        text.replace(
          'SCENARIO DRAFTED: not-applicable | 0',
          'SCENARIO DRAFTED: not-applicable | 1',
        ),
      (text) => {
        const at = text.indexOf('## Evidence Log');
        return `${text.slice(0, at)}${text
          .slice(at)
          .replaceAll(`${TASK_ID}.md`, `${TASK_ID}.md.bak`)}`;
      },
      (text) =>
        text.replace(
          'SCENARIO DRAFTED: not-applicable | 0',
          'SCENARIO DRAFTED: not-applicable | 01',
        ),
    ]) {
      const fixture = repository();
      write(fixture.root, TASK_PATH, taskText());
      write(fixture.root, SPEC_PATH, mutate(specText()));
      commit(fixture.root, 'stale or cross-subject gate evidence');
      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /checkpoint|transition|binding/i,
      );
    }

    const prefixedCount = repository();
    write(prefixedCount.root, TASK_PATH, taskText({ outcome: 'automatable' }));
    write(
      prefixedCount.root,
      SPEC_PATH,
      specText({ outcome: 'automatable' }).replace(
        'SCENARIO DRAFTED: automatable | 1',
        'SCENARIO DRAFTED: automatable | 10',
      ),
    );
    commit(prefixedCount.root, 'prefixed applicable scenario count');
    expect(messages(findHistoryFindings(prefixedCount.root, prefixedCount.base))).toMatch(
      /checkpoint|transition|binding/i,
    );
  });

  it('rejects evidence hidden by a comment after unmatched backticks or an hgroup raw block', () => {
    for (const hidden of [
      [
        '## User Execution Test Scenarios',
        '`` unmatched <!--',
        '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
        'Not applicable because this hidden comment text is long enough to mimic real evidence.',
        '-->',
      ].join('\n'),
      [
        '<hgroup> trailing raw block text',
        '## User Execution Test Scenarios',
        '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
        'Not applicable because this hidden raw HTML text is long enough to mimic real evidence.',
      ].join('\n'),
    ]) {
      const fixture = repository();
      write(
        fixture.root,
        TASK_PATH,
        taskText().replace(/## User Execution Test Scenarios[\s\S]*$/, hidden),
      );
      write(fixture.root, SPEC_PATH, specText());
      commit(fixture.root, 'hidden evidence after unmatched inline delimiter');

      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
      );
    }
  });

  it('does not use escaped backticks or a later block as an inline-code closer', () => {
    for (const hidden of [
      [
        '## User Execution Test Scenarios',
        '\\` escaped literal <!--',
        '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
        'Not applicable because this comment-hidden text is long enough to mimic real evidence.',
        '-->',
      ].join('\n'),
      [
        '` unmatched <!--',
        '# ` later ATX block with a matching-looking run',
        '## User Execution Test Scenarios',
        '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
        'Not applicable because this later-block text is hidden by the earlier HTML comment.',
        '-->',
      ].join('\n'),
    ]) {
      const fixture = repository();
      write(
        fixture.root,
        TASK_PATH,
        taskText().replace(/## User Execution Test Scenarios[\s\S]*$/, hidden),
      );
      write(fixture.root, SPEC_PATH, specText());
      commit(fixture.root, 'escaped or cross-block false inline closer');

      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
      );
    }
  });

  it('stops inline-code lookahead at a Setext boundary', () => {
    const { root, base } = repository();
    write(
      root,
      TASK_PATH,
      taskText().replace(
        /## User Execution Test Scenarios[\s\S]*$/,
        [
          '## User Execution Test Scenarios',
          '` unmatched <!--',
          'Setext heading',
          '===',
          '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
          'Not applicable because this comment-hidden text is long enough to mimic real evidence.',
          '-->',
        ].join('\n'),
      ),
    );
    write(root, SPEC_PATH, specText());
    commit(root, 'setext cross-block false closer');

    expect(messages(findHistoryFindings(root, base))).toMatch(
      /SCENARIO DRAFTED|author verdict|checkpoint|planning/i,
    );
  });

  it('does not treat a backtick-bearing info string as a fenced-code opener', () => {
    const { root, base } = repository();
    write(
      root,
      TASK_PATH,
      taskText().replace(
        '## User Execution Test Scenarios',
        ['## User Execution Test Scenarios', '```not-a-fence`'].join('\n'),
      ),
    );
    write(root, SPEC_PATH, specText());
    commit(root, 'invalid fence-like prose before real evidence');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('keeps a multiline code span across an inline HTML soft continuation', () => {
    for (const literal of [
      ['`literal marker <!--', '<span>soft continuation`'],
      ['`literal marker <!--', '<span>', 'continuation`'],
      ['`literal marker <!--', '    indented continuation`'],
      ['`literal marker <!--', 'content \\`'],
    ]) {
      const fixture = repository();
      write(
        fixture.root,
        TASK_PATH,
        taskText().replace(
          '## User Execution Test Scenarios',
          [...literal, '', '## User Execution Test Scenarios'].join('\n'),
        ),
      );
      write(fixture.root, SPEC_PATH, specText());
      commit(fixture.root, 'valid multiline code span before real evidence');

      expect(findHistoryFindings(fixture.root, fixture.base)).toEqual([]);
    }
  });

  it('rejects Task binding and GATE-IMPLEMENT tokens outside their exact sections', () => {
    const { root, base } = repository();
    write(root, TASK_PATH, taskText());
    write(
      root,
      SPEC_PATH,
      [
        '---',
        'status: in-progress',
        '---',
        '',
        `# ${TASK_ID}`,
        '',
        '## Notes',
        '',
        `- [x] \`.agents/tasks/${TASK_ID}.md\``,
        '### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25',
        '',
        '## Tasks',
        '',
        'No exact binding is recorded in this section.',
        '',
        '## Evidence Log',
        '',
        'No gate verdict is recorded in this section.',
      ].join('\n'),
    );
    commit(root, 'misplaced contract tokens');

    expect(messages(findHistoryFindings(root, base))).toMatch(/checkpoint|transition|binding/i);
  });

  it('rejects a checkpoint that mixes two Task/spec pairs', () => {
    const { root, base } = repository();
    writeCheckpoint(root);
    const other = 'HARNESS-901-other';
    write(root, `.agents/tasks/${other}.md`, taskText({ subject: other }));
    write(root, `.agents/spec-docs/active/${other}.md`, specText({ subject: other }));
    commit(root, 'ambiguous checkpoint');

    expect(messages(findHistoryFindings(root, base))).toMatch(/multiple|ambiguous/i);
  });

  it('rejects same-basename completed, done, or duplicate spec artifacts in a checkpoint', () => {
    const { root, base } = repository();
    writeCheckpoint(root);
    write(root, `.agents/tasks/completed/${TASK_ID}.md`, taskText());
    write(root, `.agents/spec-docs/done/${TASK_ID}.md`, specText());
    write(
      root,
      `.agents/spec-docs/draft/${TASK_ID}.md`,
      specText().replace('status: in-progress', 'status: draft'),
    );
    commit(root, 'checkpoint with same-basename lifecycle residue');

    expect(messages(findHistoryFindings(root, base))).toMatch(/completed|done|draft|mix/i);
  });

  it('accepts one append-only closed predecessor post-merge ledger record', () => {
    const { root, base } = repository();
    write(root, '.agents/loop-runs/post-merge-cycle.jsonl', '');
    write(
      root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify(postMergeRecord(base))}\n`,
    );
    commit(root, 'post-merge prelude');
    checkpoint(root);

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('accepts the exact approved todo-spec source deletion during a real active move', () => {
    const { root, base } = repository({ taskInBase: true });
    const todoSpec = `.agents/spec-docs/todo/${TASK_ID}.md`;
    write(
      root,
      todoSpec,
      specText()
        .replace('status: in-progress', 'status: approved')
        .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning pending.'),
    );
    commit(root, 'approved planning prelude');
    write(root, TASK_PATH, taskText());
    mkdirSync(path.join(root, '.agents/spec-docs/active'), { recursive: true });
    git(root, ['mv', todoSpec, SPEC_PATH]);
    write(root, SPEC_PATH, specText());
    commit(root, 'move approved spec into active checkpoint');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('rejects more than one predecessor post-merge prelude', () => {
    const { root, base } = repository();
    write(
      root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify(postMergeRecord(base))}\n`,
    );
    commit(root, 'first prelude');
    write(
      root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify(postMergeRecord(base))}\n${JSON.stringify(
        postMergeRecord(base, 'r20260825000001'),
      )}\n`,
    );
    commit(root, 'second prelude');
    checkpoint(root);

    expect(messages(findHistoryFindings(root, base))).toMatch(/more than one|multiple.*prelude/i);
  });

  it('rejects rewriting an earlier ledger line while appending a new one', () => {
    const { root, base } = repository();
    write(
      root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify(postMergeRecord(base))}\n`,
    );
    commit(root, 'valid prelude');
    write(
      root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify({ ...postMergeRecord(base), terminal: 'abandoned' })}\n${JSON.stringify(
        postMergeRecord(base, 'r20260825000001'),
      )}\n`,
    );
    commit(root, 'rewrite ledger history');
    checkpoint(root);

    expect(messages(findHistoryFindings(root, base))).toMatch(/append-only|ledger/i);
  });

  it('rejects a forged predecessor ledger and a ledger mixed with implementation', () => {
    const forged = repository();
    write(
      forged.root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify({
        runId: 'r20260825000000',
        opened: '2026-08-25T00:00:00.000Z',
        closed: '2026-08-25T00:01:00.000Z',
        roundFindings: [0],
        terminal: 'converged',
        ref: 'PR #1 MERGE VERIFIED PASS deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      })}\n`,
    );
    commit(forged.root, 'forged prelude');
    checkpoint(forged.root);
    expect(messages(findHistoryFindings(forged.root, forged.base))).toMatch(/ledger|ancestor/i);

    const mixed = repository();
    write(
      mixed.root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify(postMergeRecord(mixed.base))}\n`,
    );
    write(mixed.root, 'packages/example/src.ts', 'implementation\n');
    commit(mixed.root, 'mixed prelude');
    checkpoint(mixed.root);
    expect(messages(findHistoryFindings(mixed.root, mixed.base))).toContain(
      'packages/example/src.ts',
    );
  });

  it('rejects a squashed checkpoint mixed with implementation', () => {
    const { root, base } = repository();
    writeCheckpoint(root);
    write(root, 'packages/example/src.ts', 'implementation\n');
    commit(root, 'squashed planning and implementation');

    expect(messages(findHistoryFindings(root, base))).toContain('packages/example/src.ts');
  });

  it('rejects unsuccessful predecessor ledger records even when their ref claims PASS', () => {
    for (const record of [
      { ...postMergeRecord('PLACEHOLDER'), terminal: 'halted-for-user' },
      { ...postMergeRecord('PLACEHOLDER'), roundFindings: [1] },
    ]) {
      const fixture = repository();
      const bound = { ...record, ref: postMergeRecord(fixture.base).ref };
      write(fixture.root, '.agents/loop-runs/post-merge-cycle.jsonl', `${JSON.stringify(bound)}\n`);
      commit(fixture.root, 'unsuccessful predecessor ledger');
      checkpoint(fixture.root);
      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(/ledger|closed/i);
    }
  });

  it('rejects stale single-path active, completed, and done documents as planning preludes', () => {
    for (const target of ['active-task', 'active-spec', 'completed-task', 'done-spec']) {
      const fixture = repository();
      git(fixture.root, ['switch', 'develop']);
      if (target === 'active-task' || target === 'active-spec') {
        writeCheckpoint(fixture.root);
      } else if (target === 'completed-task') {
        write(fixture.root, `.agents/tasks/completed/${TASK_ID}.md`, taskText());
      } else {
        write(fixture.root, `.agents/spec-docs/done/${TASK_ID}.md`, specText());
      }
      const base = commit(fixture.root, `seed ${target}`);
      git(fixture.root, ['update-ref', 'refs/remotes/origin/develop', base]);
      git(fixture.root, ['switch', '-C', 'feature', base]);
      const changedPath =
        target === 'active-task'
          ? TASK_PATH
          : target === 'active-spec'
            ? SPEC_PATH
            : target === 'completed-task'
              ? `.agents/tasks/completed/${TASK_ID}.md`
              : `.agents/spec-docs/done/${TASK_ID}.md`;
      write(
        fixture.root,
        changedPath,
        `${readFileSync(path.join(fixture.root, changedPath), 'utf8')}\nstale evidence update\n`,
      );
      commit(fixture.root, `touch ${target}`);
      expect(messages(findHistoryFindings(fixture.root, base))).toMatch(
        /checkpoint|prelude|implementation|transition/i,
      );
    }
  });

  it('enforces exact pre-checkpoint Task and spec folder-to-status mappings', () => {
    const cases = [
      { path: TASK_PATH, text: taskText().replace('status: in-progress', 'status: approved') },
      {
        path: `.agents/spec-docs/draft/${TASK_ID}.md`,
        text: specText()
          .replace('status: in-progress', 'status: approved')
          .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning pending.'),
      },
      {
        path: `.agents/spec-docs/todo/${TASK_ID}.md`,
        text: specText()
          .replace('status: in-progress', 'status: draft')
          .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning pending.'),
      },
      {
        path: `.agents/spec-docs/active/${TASK_ID}.md`,
        text: specText()
          .replace('status: in-progress', 'status: approved')
          .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning pending.'),
      },
    ];
    for (const item of cases) {
      const fixture = repository();
      write(fixture.root, item.path, item.text);
      commit(fixture.root, 'invalid pre-checkpoint lifecycle mapping');
      expect(messages(findHistoryFindings(fixture.root, fixture.base))).toMatch(
        /checkpoint|lifecycle|status|planning/i,
      );
    }
  });

  it('rejects planning artifact deletion without a valid same-basename destination', () => {
    const fixture = repository({ taskInBase: true });
    git(fixture.root, ['switch', 'develop']);
    write(
      fixture.root,
      `.agents/spec-docs/todo/${TASK_ID}.md`,
      specText()
        .replace('status: in-progress', 'status: approved')
        .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning pending.'),
    );
    const base = commit(fixture.root, 'seed todo planning pair');
    git(fixture.root, ['update-ref', 'refs/remotes/origin/develop', base]);
    git(fixture.root, ['switch', '-C', 'feature', base]);
    git(fixture.root, ['rm', TASK_PATH, `.agents/spec-docs/todo/${TASK_ID}.md`]);
    commit(fixture.root, 'delete planning pair');

    expect(messages(findHistoryFindings(fixture.root, base))).toMatch(/delet|destination/i);
  });

  it('accepts a valid checkpoint after the topic is actually rebased onto a newer base', () => {
    const { root } = repository();
    checkpoint(root);
    write(root, 'packages/example/src.ts', 'implementation\n');
    commit(root, 'implementation');

    git(root, ['switch', 'develop']);
    write(root, 'BASE-ADVANCE.md', 'new integration base\n');
    const rebasedBase = commit(root, 'advance integration base');
    git(root, ['update-ref', 'refs/remotes/origin/develop', rebasedBase]);
    git(root, ['switch', 'feature']);
    git(root, ['rebase', 'develop']);

    expect(findHistoryFindings(root, rebasedBase)).toEqual([]);
  });
});

const AGREEMENT_PARENT = 'AGREEMENT-004-parent';
const AGREEMENT_CHILDREN = [
  ['FLOW-008', 'FLOW-008-child'],
  ['API-001', 'API-001-child'],
];

function stageAgreementPrelude(
  root,
  {
    parentTaskTransform = (text) => text,
    specTransform = (text) => text,
    childTransform = (text) => text,
  } = {},
) {
  const issue = 'https://github.com/woojubb/robota/issues/1987';
  write(
    root,
    `.agents/tasks/${AGREEMENT_PARENT}.md`,
    parentTaskTransform(
      [
        '---',
        `issue: ${issue}`,
        'status: todo',
        'children: [FLOW-008, API-001]',
        '---',
        '',
        '# AGREEMENT-004: parent',
        '',
        '## Children',
        '',
        '- [ ] FLOW-008 — todo — `.agents/tasks/FLOW-008-child.md` <!-- allow-missing-artifact: isolated Git fixture creates this Task path at runtime -->',
        '- [ ] API-001 — todo — `.agents/tasks/API-001-child.md` <!-- allow-missing-artifact: isolated Git fixture creates this Task path at runtime -->',
      ].join('\n'),
    ),
  );
  write(
    root,
    `.agents/spec-docs/draft/${AGREEMENT_PARENT}.md`,
    specTransform(
      [
        '---',
        'status: draft',
        'type: AGREEMENT',
        'tags: [typescript]',
        '---',
        '',
        '# AGREEMENT-004: parent',
        '',
        '## Tasks',
        '',
        '- [ ] FLOW-008 — todo — `.agents/tasks/FLOW-008-child.md` <!-- allow-missing-artifact: isolated Git fixture creates this Task path at runtime -->',
        '- [ ] API-001 — todo — `.agents/tasks/API-001-child.md` <!-- allow-missing-artifact: isolated Git fixture creates this Task path at runtime -->',
      ].join('\n'),
    ),
  );
  for (const [id, basename] of AGREEMENT_CHILDREN) {
    write(
      root,
      `.agents/tasks/${basename}.md`,
      childTransform(
        ['---', `issue: ${issue}`, 'status: todo', '---', '', `# ${basename}`].join('\n'),
        id,
      ),
    );
  }
  git(root, ['add', '.agents/tasks', '.agents/spec-docs/draft']);
}

describe('user-execution PLAN order — staged transaction', () => {
  it('accepts one newly staged AGREEMENT parent/spec plus its declared child Tasks', () => {
    const { root, base } = repository();
    stageAgreementPrelude(root);

    expect(findStagedFindings(root, base)).toEqual([]);
  });

  it('accepts the same atomic AGREEMENT manifest after the staged transaction is committed', () => {
    const { root, base } = repository();
    stageAgreementPrelude(root);
    expect(findStagedFindings(root, base)).toEqual([]);

    commit(root, 'convert issue into atomic agreement manifest');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('rejects an atomic AGREEMENT manifest without one concrete source Issue', () => {
    const { root, base } = repository();
    const removeIssue = (text) => text.replace(/^issue:.*\n/m, '');
    stageAgreementPrelude(root, {
      parentTaskTransform: removeIssue,
      childTransform: removeIssue,
    });

    expect(messages(findStagedFindings(root, base))).toMatch(/source issue/i);
  });

  it.each([
    {
      name: 'unrelated implementation path',
      arrange(root) {
        stageAgreementPrelude(root);
        write(root, 'packages/example/unrelated.ts', 'implementation\n');
        git(root, ['add', 'packages/example/unrelated.ts']);
      },
      expected: /unrelated path/i,
    },
    {
      name: 'duplicate child declaration',
      arrange(root) {
        stageAgreementPrelude(root, {
          parentTaskTransform: (text) =>
            text.replace(
              'children: [FLOW-008, API-001]',
              'children: [FLOW-008, FLOW-008, API-001]',
            ),
        });
      },
      expected: /unique|project/i,
    },
    {
      name: 'unresolved child declaration',
      arrange(root) {
        stageAgreementPrelude(root, {
          parentTaskTransform: (text) =>
            text.replace('children: [FLOW-008, API-001]', 'children: [FLOW-008, DATA-999]'),
        });
      },
      expected: /DATA-999.*exactly one staged Task/i,
    },
    {
      name: 'non-todo child',
      arrange(root) {
        stageAgreementPrelude(root, {
          childTransform: (text, id) =>
            id === 'FLOW-008' ? text.replace('status: todo', 'status: in-progress') : text,
        });
      },
      expected: /FLOW-008.*status `todo`/i,
    },
    {
      name: 'nested AGREEMENT child',
      arrange(root) {
        stageAgreementPrelude(root, {
          childTransform: (text, id) =>
            id === 'FLOW-008'
              ? text.replace('status: todo', 'status: todo\nchildren: [DATA-999]')
              : text,
        });
      },
      expected: /nested AGREEMENT/i,
    },
    {
      name: 'source Issue mismatch',
      arrange(root) {
        stageAgreementPrelude(root, {
          childTransform: (text, id) =>
            id === 'FLOW-008' ? text.replace('/issues/1987', '/issues/1988') : text,
        });
      },
      expected: /parent source issue/i,
    },
    {
      name: 'malformed projection',
      arrange(root) {
        stageAgreementPrelude(root, {
          specTransform: (text) => text.replace('FLOW-008 — todo', 'FLOW-008 todo'),
        });
      },
      expected: /Tasks.*malformed|Tasks.*project/i,
    },
  ])('rejects atomic AGREEMENT manifest: $name', ({ arrange, expected }) => {
    const { root, base } = repository();
    arrange(root);

    expect(messages(findStagedFindings(root, base))).toMatch(expected);
  });

  it('rejects rewriting a pre-existing child as part of an atomic AGREEMENT prelude', () => {
    const root = makeTemp('robota-agreement-existing-child-');
    git(root, ['init', '-b', 'develop']);
    git(root, ['config', 'user.email', 'fixture@example.com']);
    git(root, ['config', 'user.name', 'Fixture']);
    write(root, 'README.md', 'base\n');
    write(
      root,
      '.agents/tasks/FLOW-008-child.md',
      [
        '---',
        'issue: https://github.com/woojubb/robota/issues/1987',
        'status: todo',
        '---',
        '',
        '# existing child',
      ].join('\n'),
    );
    const base = commit(root, 'base (#1)');
    git(root, ['update-ref', 'refs/remotes/origin/develop', base]);
    git(root, ['switch', '-c', 'feature']);
    stageAgreementPrelude(root);

    expect(messages(findStagedFindings(root, base))).toMatch(/FLOW-008.*newly added/i);
  });

  it('rejects staged implementation before HEAD contains a checkpoint', () => {
    const { root, base } = repository();
    write(root, 'packages/example/src.ts', 'implementation\n');
    git(root, ['add', 'packages/example/src.ts']);

    expect(messages(findStagedFindings(root, base))).toMatch(/checkpoint/i);
  });

  it('accepts exactly one verified predecessor post-merge ledger append in the index', () => {
    const { root, base } = repository();
    write(
      root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify(postMergeRecord(base))}\n`,
    );
    git(root, ['add', '.agents/loop-runs/post-merge-cycle.jsonl']);

    expect(findStagedFindings(root, base)).toEqual([]);
  });

  it('rejects forged or mixed staged predecessor post-merge ledger appends', () => {
    const forged = repository();
    write(
      forged.root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify({ ...postMergeRecord(forged.base), ref: `PR #1 MERGE VERIFIED PASS ${'f'.repeat(40)}` })}\n`,
    );
    git(forged.root, ['add', '.agents/loop-runs/post-merge-cycle.jsonl']);
    expect(messages(findStagedFindings(forged.root, forged.base))).toMatch(/post-merge|verified/i);

    const mixed = repository();
    write(
      mixed.root,
      '.agents/loop-runs/post-merge-cycle.jsonl',
      `${JSON.stringify(postMergeRecord(mixed.base))}\n`,
    );
    write(mixed.root, 'packages/example/implementation.ts', 'implementation\n');
    git(mixed.root, [
      'add',
      '.agents/loop-runs/post-merge-cycle.jsonl',
      'packages/example/implementation.ts',
    ]);
    expect(messages(findStagedFindings(mixed.root, mixed.base))).toMatch(/post-merge|mixed/i);
  });

  it('allows a planning-only draft/todo prelude before the checkpoint', () => {
    const { root, base } = repository();
    write(root, TASK_PATH, taskText().replace('status: in-progress', 'status: todo'));
    write(
      root,
      `.agents/spec-docs/todo/${TASK_ID}.md`,
      specText()
        .replace('status: in-progress', 'status: approved')
        .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning evidence pending.'),
    );
    git(root, ['add', TASK_PATH, `.agents/spec-docs/todo/${TASK_ID}.md`]);

    expect(findStagedFindings(root, base)).toEqual([]);
  });

  it('rejects unstaged and untracked implementation during a planning prelude', () => {
    for (const residue of ['untracked', 'unstaged']) {
      const { root, base } = repository();
      write(root, TASK_PATH, taskText().replace('status: in-progress', 'status: todo'));
      write(
        root,
        `.agents/spec-docs/todo/${TASK_ID}.md`,
        specText()
          .replace('status: in-progress', 'status: approved')
          .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning evidence pending.'),
      );
      git(root, ['add', TASK_PATH, `.agents/spec-docs/todo/${TASK_ID}.md`]);
      if (residue === 'untracked') {
        write(root, 'packages/example/hidden.ts', 'untracked implementation\n');
      } else {
        write(root, 'README.md', 'unstaged implementation\n');
      }

      expect(messages(findStagedFindings(root, base))).toMatch(/unstaged|untracked|worktree/i);
    }
  });

  it('rejects a proposed checkpoint with hidden unstaged or untracked implementation', () => {
    const { root, base } = repository();
    writeCheckpoint(root);
    git(root, ['add', TASK_PATH, SPEC_PATH]);
    write(root, 'packages/example/hidden.ts', 'untracked implementation\n');

    expect(messages(findStagedFindings(root, base))).toContain('packages/example/hidden.ts');
  });

  it('rejects hidden unstaged same-basename lifecycle residue during a checkpoint', () => {
    const { root, base } = repository();
    writeCheckpoint(root);
    git(root, ['add', TASK_PATH, SPEC_PATH]);
    write(root, `.agents/spec-docs/done/${TASK_ID}.md`, specText());

    expect(messages(findStagedFindings(root, base))).toMatch(/done|worktree|checkpoint/i);
  });

  it('rejects rename and deletion paths mixed into a proposed checkpoint', () => {
    const { root, base } = repository();
    writeCheckpoint(root);
    git(root, ['add', TASK_PATH, SPEC_PATH]);
    git(root, ['mv', 'README.md', 'RENAMED.md']);

    expect(messages(findStagedFindings(root, base))).toMatch(/README\.md|RENAMED\.md/);
  });

  it('rejects an unbound or rewritten PLAN ledger in a proposed checkpoint', () => {
    const { root, base } = repository();
    writeCheckpoint(root);
    git(root, ['add', TASK_PATH, SPEC_PATH]);
    write(
      root,
      '.agents/loop-runs/user-execution-scenario.jsonl',
      `${JSON.stringify({
        runId: 'r1',
        opened: '2026-08-25T00:00:00.000Z',
        closed: '2026-08-25T00:01:00.000Z',
        roundFindings: [0],
        terminal: 'converged',
        ref: 'HARNESS-901-other',
      })}\n`,
    );
    git(root, ['add', '.agents/loop-runs/user-execution-scenario.jsonl']);

    expect(messages(findStagedFindings(root, base))).toMatch(/ledger|subject-bound/i);
  });

  it('rejects rewriting an existing PLAN ledger line while appending a bound record', () => {
    const seeded = repository();
    git(seeded.root, ['switch', 'develop']);
    write(
      seeded.root,
      '.agents/loop-runs/user-execution-scenario.jsonl',
      `${JSON.stringify(userScenarioRecord('HARNESS-899-prior'))}\n`,
    );
    const base = commit(seeded.root, 'seed prior PLAN ledger');
    git(seeded.root, ['update-ref', 'refs/remotes/origin/develop', base]);
    git(seeded.root, ['switch', '-C', 'feature', base]);
    writeCheckpoint(seeded.root);
    git(seeded.root, ['add', TASK_PATH, SPEC_PATH]);
    write(
      seeded.root,
      '.agents/loop-runs/user-execution-scenario.jsonl',
      `${JSON.stringify(userScenarioRecord('HARNESS-899-rewritten'))}\n${JSON.stringify(
        userScenarioRecord(TASK_ID, 'r20260825000001'),
      )}\n`,
    );
    git(seeded.root, ['add', '.agents/loop-runs/user-execution-scenario.jsonl']);

    expect(messages(findStagedFindings(seeded.root, base))).toMatch(/append-only|ledger/i);
  });

  it('accepts one strictly shaped, exactly bound PLAN ledger append in the checkpoint', () => {
    const { root, base } = repository();
    writeCheckpoint(root);
    write(
      root,
      '.agents/loop-runs/user-execution-scenario.jsonl',
      `${JSON.stringify(userScenarioRecord())}\n`,
    );
    git(root, ['add', TASK_PATH, SPEC_PATH, '.agents/loop-runs/user-execution-scenario.jsonl']);

    expect(findStagedFindings(root, base)).toEqual([]);
  });

  it('binds v1 worktreePaths to the exact staged PLAN ledger inventory', () => {
    const omitted = repository({ withContract: true });
    writeCheckpoint(omitted.root, {
      v1: true,
      worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
    });
    write(
      omitted.root,
      '.agents/loop-runs/user-execution-scenario.jsonl',
      `${JSON.stringify(userScenarioRecord())}\n`,
    );
    git(omitted.root, ['add', '-A']);
    expect(messages(findStagedFindings(omitted.root, omitted.base))).toMatch(
      /worktreePaths.*exact.*inventory/i,
    );

    const invented = repository({ withContract: true });
    writeCheckpoint(invented.root, {
      v1: true,
      worktreeLine: '- Whole-worktree precondition: planning-only inventory is recorded.',
    });
    const current = readFileSync(path.join(invented.root, SPEC_PATH), 'utf8');
    write(
      invented.root,
      SPEC_PATH,
      current.replace(
        '"worktreePaths": [\n    ".agents/spec-docs',
        '"worktreePaths": [\n    ".agents/loop-runs/user-execution-scenario.jsonl",\n    ".agents/spec-docs',
      ),
    );
    git(invented.root, ['add', '-A']);
    expect(messages(findStagedFindings(invented.root, invented.base))).toMatch(
      /worktreePaths.*exact.*inventory/i,
    );
  });

  it('allows implementation staging after HEAD contains the valid checkpoint', () => {
    const { root, base } = repository();
    checkpoint(root);
    write(root, 'packages/example/src.ts', 'implementation\n');
    git(root, ['add', 'packages/example/src.ts']);

    expect(findStagedFindings(root, base)).toEqual([]);
  });

  it('rejects a second actual Task/spec checkpoint transition in both staged and history modes', () => {
    const { root, base } = repository();
    checkpoint(root);
    const other = 'HARNESS-901-second-unit';
    const otherTask = `.agents/tasks/${other}.md`;
    const otherSpec = `.agents/spec-docs/active/${other}.md`;
    write(root, otherTask, taskText({ subject: other }));
    write(root, otherSpec, specText({ subject: other }));
    git(root, ['add', otherTask, otherSpec]);

    expect(messages(findStagedFindings(root, base))).toMatch(/second|multiple|checkpoint/i);
    commit(root, 'second checkpoint transition');
    expect(messages(findHistoryFindings(root, base))).toMatch(/multiple.*checkpoint/i);
  });

  it('rejects a same-basename checkpoint re-transition in staged mode', () => {
    const { root, base } = repository();
    checkpoint(root);
    write(
      root,
      TASK_PATH,
      taskText()
        .replace('status: in-progress', 'status: todo')
        .replace(/\nverified\n?$/, ''),
    );
    write(
      root,
      SPEC_PATH,
      specText()
        .replace('status: in-progress', 'status: approved')
        .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning reset.'),
    );
    commit(root, 'illegally reset checkpoint state');
    writeCheckpoint(root);
    git(root, ['add', TASK_PATH, SPEC_PATH]);

    expect(messages(findStagedFindings(root, base))).toMatch(/second|checkpoint|transition/i);
  });

  it('rejects a bare Task ID or unstaged residue as PLAN ledger binding', () => {
    const bare = repository();
    writeCheckpoint(bare.root);
    write(
      bare.root,
      '.agents/loop-runs/user-execution-scenario.jsonl',
      `${JSON.stringify(userScenarioRecord('HARNESS-900'))}\n`,
    );
    git(bare.root, [
      'add',
      TASK_PATH,
      SPEC_PATH,
      '.agents/loop-runs/user-execution-scenario.jsonl',
    ]);
    expect(messages(findStagedFindings(bare.root, bare.base))).toMatch(/subject-bound|ledger/i);

    const residue = repository();
    writeCheckpoint(residue.root);
    const ledger = '.agents/loop-runs/user-execution-scenario.jsonl';
    const valid = `${JSON.stringify(userScenarioRecord())}\n`;
    write(residue.root, ledger, valid);
    git(residue.root, ['add', TASK_PATH, SPEC_PATH, ledger]);
    write(residue.root, ledger, `${valid}${JSON.stringify(userScenarioRecord('HARNESS-999'))}\n`);
    expect(messages(findStagedFindings(residue.root, residue.base))).toMatch(/worktree|ledger/i);
  });
});

describe("HARNESS-127 — the catalogue's spelling of the worktree criterion", () => {
  // The GATE-IMPLEMENT checkpoint entry must mention the whole worktree. The catalogue that owns the
  // criterion writes `whole worktree`; the fixture above writes `Whole-worktree`. Both are the same
  // phrase and both must be accepted, or a guardian that quotes the catalogue verbatim is refused for
  // a hyphen it had no way to know about (issue #2378). The two TC-03 cases read the catalogue's own
  // words at test time so the next drift between the document and the scan is a red case here.
  const inventory = `: only \`${TASK_PATH}\` and \`.agents/spec-docs/todo/${TASK_ID}.md\` are present; no implementation path exists.`;

  function gateImplementSection() {
    const root = path.resolve(import.meta.dirname, '../../..');
    const catalogue = readFileSync(path.join(root, '.agents/specs/gate-catalogue.md'), 'utf8');
    const lines = catalogue.split('\n');
    const start = lines.findIndex((line) => /^### GATE-IMPLEMENT\b/.test(line));
    expect(start, 'gate-catalogue.md has a `### GATE-IMPLEMENT` heading').toBeGreaterThan(-1);
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^#{1,3} /.test(lines[index])) {
        end = index;
        break;
      }
    }
    return lines.slice(start + 1, end);
  }

  function catalogueCriterionItem() {
    const items = [];
    for (const line of gateImplementSection()) {
      if (/^- \[ \] /.test(line)) items.push([line.replace(/^- \[ \] /, '')]);
      else if (/^\s+\S/.test(line) && items.length > 0 && items.at(-1))
        items.at(-1).push(line.trim());
      else items.push(null);
    }
    const worktreeItems = items.filter(
      (item) => item && item.some((line) => /worktree/i.test(line)),
    );
    expect(
      worktreeItems,
      'gate-catalogue.md § GATE-IMPLEMENT has exactly one `- [ ]` item that mentions the worktree',
    ).toHaveLength(1);
    return worktreeItems[0].join(' ');
  }

  function catalogueInstructionParagraph() {
    const section = gateImplementSection();
    const starts = section
      .map((line, index) => (/^\*\*Evidence to record on PASS:\*\*/.test(line) ? index : -1))
      .filter((index) => index !== -1);
    expect(
      starts,
      'gate-catalogue.md § GATE-IMPLEMENT has exactly one `**Evidence to record on PASS:**` paragraph',
    ).toHaveLength(1);
    const paragraph = [];
    for (
      let index = starts[0];
      index < section.length && section[index].trim() !== '';
      index += 1
    ) {
      paragraph.push(section[index]);
    }
    // The case below is named for the soft-wrap. If the catalogue is ever reflowed onto one line this
    // case silently becomes TC-03a again and mutant C (`[- ]`) survives — so the wrap is asserted,
    // making a reflow a visible red rather than a quiet loss of distinguishing power.
    expect(
      paragraph.join('\n'),
      'the Evidence-to-record paragraph soft-wraps between `whole` and `worktree`',
    ).toMatch(/whole\s*\n\s*worktree/);
    return paragraph.join('\n');
  }

  it('accepts a checkpoint whose worktree line quotes the catalogue criterion verbatim (TC-01)', () => {
    const { root, base } = repository();
    write(root, TASK_PATH, taskText());
    write(
      root,
      SPEC_PATH,
      specText({
        worktreeLine: `- The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired Task/spec planning artifacts and any subject-bound PLAN ledger record${inventory}`,
      }),
    );
    commit(root, 'planning checkpoint quoting the catalogue');

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('still refuses a checkpoint whose worktree line carries neither spelling (TC-02)', () => {
    const { root, base } = repository();
    write(root, TASK_PATH, taskText());
    write(root, SPEC_PATH, specText({ worktreeLine: `- Path inventory${inventory}` }));
    commit(root, 'planning checkpoint with no worktree token');

    expect(messages(findHistoryFindings(root, base))).toMatch(/checkpoint|transition/i);
  });

  it.each([
    ['the criterion item', () => catalogueCriterionItem()],
    ['the Evidence-to-record instruction, soft-wrap intact', () => catalogueInstructionParagraph()],
  ])("accepts the catalogue's own words as the worktree line — %s (TC-03)", (_name, phrase) => {
    const text = phrase();
    expect(text).toMatch(/worktree/i);
    const { root, base } = repository();
    write(root, TASK_PATH, taskText());
    write(root, SPEC_PATH, specText({ worktreeLine: `- ${text}${inventory}` }));
    commit(root, "planning checkpoint in the catalogue's words");

    expect(findHistoryFindings(root, base)).toEqual([]);
  });
});

describe('PROC-016 — the L1 lane checkpoint and loop-run ledger appends', () => {
  // An L1 spec (`lane: L1`) has two gates, PLAN (`draft → approved`) and DONE; it never enters
  // `active/` and never carries `in-progress`, so the L2 checkpoint shape (active/ + GATE-IMPLEMENT)
  // can never occur for it. Its checkpoint is the commit that first gives the `todo/` spec a complete
  // GATE-PLAN PASS. Measured on INFRA-135: without this rule every implementation commit after a
  // correct PLAN PASS was refused as `no planning checkpoint`.
  const DRAFT_SPEC_PATH = `.agents/spec-docs/draft/${TASK_ID}.md`;
  const TODO_SPEC_PATH = `.agents/spec-docs/todo/${TASK_ID}.md`;
  const USER_REQUEST_LEDGER = '.agents/loop-runs/user-request-gate.jsonl';
  const IMPLEMENTATION_PATH = 'scripts/harness/change.mjs';

  function ledgerRecord(runId = 'r20260827000000') {
    return `${JSON.stringify({
      runId,
      opened: '2026-08-27T00:00:00.000Z',
      closed: '2026-08-27T00:01:00.000Z',
      roundFindings: [0],
      extensions: {},
      terminal: 'converged',
      ref: null,
    })}\n`;
  }

  function l1SpecText({
    lane = 'L1',
    status = 'approved',
    planEntry = true,
    taskLine = `- GATE-WRITE — Task record: \`${TASK_PATH}\` exists and maps the completion criteria.`,
    signalLine = '- GATE-WRITE — user-execution PLAN terminal outcome: Task records `SCENARIO DRAFTED: not-applicable | 0`.',
  } = {}) {
    return [
      '---',
      `status: ${status}`,
      ...(lane === null ? [] : [`lane: ${lane}`]),
      'type: INFRA',
      '---',
      '',
      `# ${TASK_ID}`,
      '',
      '## Tasks',
      '',
      `- [ ] \`${TASK_PATH}\``,
      '',
      '## Evidence Log',
      '',
      ...(planEntry
        ? [
            '### [GATE-PLAN] — ✅ PASS | 2026-08-27',
            '',
            '**Status upgrade:** draft → approved',
            '',
            taskLine,
            signalLine,
            '',
          ]
        : ['Planning pending.', '']),
    ].join('\n');
  }

  function l1TaskText() {
    return taskText().replace('status: in-progress', 'status: todo');
  }

  function l1Prelude(root, options = {}) {
    write(root, TASK_PATH, l1TaskText());
    write(root, DRAFT_SPEC_PATH, l1SpecText({ ...options, status: 'draft', planEntry: false }));
    return commit(root, 'L1 draft prelude');
  }

  function writeL1Checkpoint(root, options = {}) {
    git(root, ['rm', '-q', DRAFT_SPEC_PATH]);
    write(root, TODO_SPEC_PATH, l1SpecText(options));
  }

  function l1Checkpoint(root, options = {}) {
    writeL1Checkpoint(root, options);
    return commit(root, 'L1 PLAN checkpoint');
  }

  function implementation(root) {
    write(root, IMPLEMENTATION_PATH, 'implementation\n');
    return commit(root, 'implementation');
  }

  it('accepts implementation after an L1 PLAN PASS checkpoint in todo/ (TC-a)', () => {
    const { root, base } = repository();
    l1Prelude(root);
    l1Checkpoint(root);
    implementation(root);

    expect(findHistoryFindings(root, base)).toEqual([]);
    expect(readExaminedPlanOrderCount(root, base)).toBe(3);

    write(root, 'packages/example/src.ts', 'more implementation\n');
    git(root, ['add', 'packages/example/src.ts']);
    expect(findStagedFindings(root, base)).toEqual([]);
  });

  it('accepts an L1 checkpoint whose Task is already in-progress, and one with a ledger append', () => {
    const { root, base } = repository();
    l1Prelude(root);
    write(root, TASK_PATH, taskText());
    writeL1Checkpoint(root);
    write(root, USER_REQUEST_LEDGER, ledgerRecord());
    commit(root, 'L1 PLAN checkpoint with an in-progress Task and a ledger record');
    implementation(root);

    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('refuses implementation that precedes the L1 PLAN PASS (TC-b)', () => {
    const before = repository();
    l1Prelude(before.root);
    implementation(before.root);
    l1Checkpoint(before.root);
    const findings = findHistoryFindings(before.root, before.base);
    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toMatch(/before the planning checkpoint/);
    expect(findings[0].problem).toContain(IMPLEMENTATION_PATH);

    const never = repository();
    l1Prelude(never.root);
    implementation(never.root);
    const neverFindings = findHistoryFindings(never.root, never.base);
    expect(neverFindings).toHaveLength(1);
    expect(neverFindings[0].problem).toMatch(/no planning checkpoint/);
    expect(neverFindings[0].problem).toContain(IMPLEMENTATION_PATH);
  });

  it.each([
    ['the paired Task path', { taskLine: '- GATE-WRITE — Task record: exists.' }],
    [
      'the SCENARIO DRAFTED signal',
      { signalLine: '- GATE-WRITE — user-execution PLAN terminal outcome: recorded.' },
    ],
    [
      "a count that is not the Task's",
      {
        signalLine:
          '- GATE-WRITE — user-execution PLAN terminal outcome: Task records `SCENARIO DRAFTED: not-applicable | 1`.',
      },
    ],
    ['the draft → approved upgrade line', { status: 'approved', planEntry: true, lane: 'L1' }],
  ])('refuses an L1 PLAN entry missing %s as no checkpoint (TC-c)', (name, options) => {
    const { root, base } = repository();
    l1Prelude(root);
    if (name === 'the draft → approved upgrade line') {
      git(root, ['rm', '-q', DRAFT_SPEC_PATH]);
      write(
        root,
        TODO_SPEC_PATH,
        l1SpecText(options).replace(
          '**Status upgrade:** draft → approved',
          '**Status upgrade:** approved → in-progress',
        ),
      );
      commit(root, 'L1 PLAN entry with the wrong upgrade');
    } else {
      l1Checkpoint(root, options);
    }

    const findings = findHistoryFindings(root, base);
    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toMatch(/GATE-PLAN/);

    implementation(root);
    expect(messages(findHistoryFindings(root, base))).toMatch(/no planning checkpoint/);
  });

  it('leaves the L2 rule untouched: a GATE-PLAN entry on an L2 spec is not a checkpoint (TC-d)', () => {
    for (const lane of [null, 'L2']) {
      const { root, base } = repository();
      l1Prelude(root, { lane });
      l1Checkpoint(root, { lane });
      implementation(root);

      const findings = findHistoryFindings(root, base);
      expect(findings.map((item) => item.problem).join('\n')).toMatch(/no planning checkpoint/);
      expect(findings.some((item) => item.problem.includes(IMPLEMENTATION_PATH))).toBe(true);
    }

    const l2 = repository();
    checkpoint(l2.root);
    implementation(l2.root);
    expect(findHistoryFindings(l2.root, l2.base)).toEqual([]);
  });

  it('refuses an L1 checkpoint mixed with implementation, in history and staged', () => {
    const { root, base } = repository();
    l1Prelude(root);
    writeL1Checkpoint(root);
    write(root, IMPLEMENTATION_PATH, 'implementation\n');
    git(root, ['add', '-A']);
    expect(messages(findStagedFindings(root, base))).toContain(IMPLEMENTATION_PATH);

    commit(root, 'squashed L1 planning and implementation');
    expect(messages(findHistoryFindings(root, base))).toContain(IMPLEMENTATION_PATH);
  });

  it('judges a staged L1 checkpoint by name and accepts a complete one', () => {
    const complete = repository();
    l1Prelude(complete.root);
    writeL1Checkpoint(complete.root);
    git(complete.root, ['add', '-A']);
    expect(findStagedFindings(complete.root, complete.base)).toEqual([]);

    const incomplete = repository();
    l1Prelude(incomplete.root);
    writeL1Checkpoint(incomplete.root, { taskLine: '- GATE-WRITE — Task record: exists.' });
    git(incomplete.root, ['add', '-A']);
    const findings = findStagedFindings(incomplete.root, incomplete.base);
    expect(findings.length).toBeGreaterThan(0);
    expect(messages(findings)).toMatch(/GATE-PLAN/);
  });

  it('refuses a second L1 checkpoint after the first, like a second L2 one', () => {
    const { root, base } = repository();
    l1Prelude(root);
    l1Checkpoint(root);
    const other = 'HARNESS-901-second-l1-fixture';
    write(root, `.agents/tasks/${other}.md`, l1TaskText().replaceAll(TASK_ID, other));
    write(root, `.agents/spec-docs/todo/${other}.md`, l1SpecText().replaceAll(TASK_ID, other));
    commit(root, 'second L1 PLAN checkpoint');

    expect(messages(findHistoryFindings(root, base))).toMatch(
      /second work-unit planning checkpoint/,
    );
  });

  it('allows a pure append to the user-request-gate ledger before an L2 checkpoint (TC-e)', () => {
    const { root, base } = repository();
    write(root, USER_REQUEST_LEDGER, ledgerRecord());
    commit(root, 'ledger-only prelude');
    write(root, TASK_PATH, taskText().replace('status: in-progress', 'status: todo'));
    write(
      root,
      DRAFT_SPEC_PATH,
      specText()
        .replace('status: in-progress', 'status: draft')
        .replace('### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25', 'Planning pending.'),
    );
    write(root, USER_REQUEST_LEDGER, `${ledgerRecord()}${ledgerRecord('r20260827000001')}`);
    commit(root, 'draft prelude with a ledger append');
    expect(findHistoryFindings(root, base)).toEqual([]);

    write(
      root,
      USER_REQUEST_LEDGER,
      `${ledgerRecord()}${ledgerRecord('r20260827000001')}${ledgerRecord('r20260827000002')}`,
    );
    git(root, ['add', USER_REQUEST_LEDGER]);
    expect(findStagedFindings(root, base)).toEqual([]);

    checkpoint(root);
    write(root, IMPLEMENTATION_PATH, 'implementation\n');
    commit(root, 'implementation');
    expect(findHistoryFindings(root, base)).toEqual([]);
  });

  it('refuses a prelude that rewrites an existing ledger line (TC-e)', () => {
    const { root, base } = repository();
    write(root, USER_REQUEST_LEDGER, ledgerRecord());
    commit(root, 'ledger-only prelude');
    write(root, TASK_PATH, taskText().replace('status: in-progress', 'status: todo'));
    write(
      root,
      USER_REQUEST_LEDGER,
      `${ledgerRecord().replace('"converged"', '"abandoned"')}${ledgerRecord('r20260827000001')}`,
    );
    git(root, ['add', '-A']);
    expect(messages(findStagedFindings(root, base))).toMatch(/no planning checkpoint/);

    commit(root, 'rewrite a sealed ledger line');
    checkpoint(root);
    const findings = findHistoryFindings(root, base);
    expect(messages(findings)).toMatch(/pure append/);
    expect(messages(findings)).toContain(USER_REQUEST_LEDGER);
  });

  it('keeps the post-merge ledger outside the generic append allowance', () => {
    const { root, base } = repository();
    write(root, TASK_PATH, taskText().replace('status: in-progress', 'status: todo'));
    write(root, '.agents/loop-runs/post-merge-cycle.jsonl', ledgerRecord());
    commit(root, 'prelude with an unbound post-merge record');
    checkpoint(root);

    expect(messages(findHistoryFindings(root, base))).toMatch(/post-merge ledger/);
  }, 300_000);
});

describe('user-execution PLAN order — repository contract', () => {
  it('passes on this branch and includes the real predecessor prelude plus planning transition', async () => {
    const result = await execFileAsync(
      process.execPath,
      [
        path.join(WORKSPACE_ROOT, 'scripts/harness/scan-user-execution-plan-order.mjs'),
        '--history',
      ],
      { cwd: WORKSPACE_ROOT },
    );
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/::examined:: \d+ topic commit\(s\)/);
  }, 300_000);

  it('prefers HARNESS_BASE_REF over the pull-request base for promotion verification', () => {
    const { root, base } = repository();
    checkpoint(root);
    git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

    expect(
      resolveTopicMergeBase(root, undefined, {
        HARNESS_BASE_REF: 'origin/develop',
        GITHUB_BASE_REF: 'main',
      }),
    ).toBe(base);
  });

  it('binds the rule, gate, and orchestrators to the non-circular checkpoint sequence', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const rule = readFileSync(path.join(root, '.agents/rules/backlog-execution.md'), 'utf8');
    const catalogue = readFileSync(path.join(root, '.agents/specs/gate-catalogue.md'), 'utf8');
    const scenario = readFileSync(
      path.join(root, '.agents/skills/user-execution-scenario/SKILL.md'),
      'utf8',
    );
    const orchestrator = readFileSync(
      path.join(root, '.agents/skills/backlog-execution-orchestrator/SKILL.md'),
      'utf8',
    );

    expect(rule).toContain('planning checkpoint');
    expect(rule).toContain('whole worktree');
    expect(catalogue).toMatch(/GATE-IMPLEMENT[\s\S]*DONE-GATE-STAGE-1/);
    expect(catalogue).toMatch(/GATE-IMPLEMENT[\s\S]*not-applicable/);
    expect(scenario).toContain('subject-bound');
    expect(orchestrator).toMatch(/GATE-IMPLEMENT[\s\S]*checkpoint[\s\S]*Phase 3/);
  });

  it('is reached by both the Husky pre-commit hook and mandatory scan registry', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const hook = readFileSync(path.join(root, '.husky/pre-commit'), 'utf8');
    const runner = readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8');

    expect(hook).toContain('node scripts/harness/scan-user-execution-plan-order.mjs --staged');
    expect(runner).toContain("name: 'user-execution-plan-order'");
    expect(runner).toContain("'node', 'scripts/harness/scan-user-execution-plan-order.mjs'");
  });

  it('propagates a staged PLAN guard failure from the pre-commit hook', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const hook = readFileSync(path.join(root, '.husky/pre-commit'), 'utf8');

    expect(hook).toContain(
      'node scripts/harness/scan-user-execution-plan-order.mjs --staged || exit 1',
    );
  });
});

describe('the finders read only the root they are given (PROC-016)', () => {
  it('a root without its own .git is refused, not read through git discovery', () => {
    const bare = makeTemp('robota-ues-plan-order-bare-');
    write(bare, 'README.md', 'no repository here\n');
    const history = findHistoryFindings(bare);
    expect(history).toHaveLength(1);
    expect(history[0].problem ?? history[0].message ?? JSON.stringify(history[0])).toMatch(
      /has no \.git|failed closed/,
    );
    const staged = findStagedFindings(bare);
    expect(staged).toHaveLength(1);
  });

  it("the hook's ambient GIT_DIR cannot redirect a .git-less root to another repository", async () => {
    const created = repository();
    const real = typeof created === 'string' ? created : created.root;
    const bare = makeTemp('robota-ues-plan-order-bare-');
    write(bare, 'README.md', 'no repository here\n');
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(real, '.git');
    try {
      const history = findHistoryFindings(bare);
      expect(history).toHaveLength(1);
      expect(JSON.stringify(history[0])).toMatch(/has no \.git|failed closed/);
      // Control: the real repository root itself is still read.
      const result = await execFileAsync(
        process.execPath,
        [
          path.join(WORKSPACE_ROOT, 'scripts/harness/scan-user-execution-plan-order.mjs'),
          '--history',
        ],
        { cwd: real },
      );
      expect(result.stderr).toBe('');
      expect(result.stdout).toMatch(/::examined:: \d+ topic commit\(s\)/);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  }, 300_000);
});
