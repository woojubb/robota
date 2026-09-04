import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  examinedArchitectureRunCount,
  findArchitectureRefreshSignalFindings as findRawArchitectureRefreshSignalFindings,
} from '../scan-architecture-refresh-signals.mjs';
import { SCAN_COMMANDS } from '../run-all-scans.mjs';
import { makeTemp } from './make-temp.mjs';

const DIMENSIONS = ['structure', 'design', 'runtime', 'gate'];

function findArchitectureRefreshSignalFindings(root) {
  return findRawArchitectureRefreshSignalFindings(root).filter(
    (finding) => finding.runId !== '(proof-floor)',
  );
}

function workspace() {
  const root = makeTemp('robota-architecture-refresh-signals-');
  for (const [name, loop] of [
    ['architecture-audit-fanout', 'over=finding-set; escape=no-progress; bound=3 rounds'],
    ['architecture-refresh', 'over=finding-set; escape=no-progress; bound=3 rounds'],
  ]) {
    mkdirSync(path.join(root, '.agents/skills', name), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: fixture\nloop: ${loop}\n---\n\nloop-run.mjs\n`,
      'utf8',
    );
  }
  mkdirSync(path.join(root, '.agents/loop-runs'), { recursive: true });
  return root;
}

function writeLedger(root, skill, entries) {
  writeFileSync(
    path.join(root, '.agents/loop-runs', `${skill}.jsonl`),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  );
}

const expectation = (round, phase, agent, subject, token, cells) => ({
  round,
  phase,
  agent,
  subject,
  token,
  ...(cells ? { cells } : {}),
});
const observation = (round, phase, agent, subject, signal) => ({
  round,
  phase,
  agent,
  subject,
  signal,
});

function metadata(overrides = {}) {
  return {
    signalExpectations: [],
    signalObservations: [],
    verificationPassThroughIds: [],
    draftFindings: [],
    finalFindings: [],
    foundationalIds: [],
    reconciliationRoutes: [],
    dispositions: [],
    nestedRuns: [],
    ...overrides,
  };
}

function entry(runId, roundFindings, terminal, architectureRefresh) {
  return {
    runId,
    opened: '2026-08-22T00:00:00.000Z',
    closed: terminal === null ? null : '2026-08-22T00:02:00.000Z',
    roundFindings,
    extensions: { architectureRefresh },
    terminal,
    ref: null,
  };
}

function fanoutRun(runId = 'fanout-r1') {
  const signalExpectations = DIMENSIONS.map((dim) =>
    expectation(1, 'audit', `architecture-${dim}-auditor`, `${dim}:1/1`, 'AUDIT-DIM-COMPLETE', [
      `${dim}:target:c1`,
    ]),
  );
  const signalObservations = DIMENSIONS.map((dim) =>
    observation(
      1,
      'audit',
      `architecture-${dim}-auditor`,
      `${dim}:1/1`,
      `AUDIT-DIM-COMPLETE: dim=${dim} shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=1/1 uncovered=none`,
    ),
  );
  return entry(runId, [0], 'converged', metadata({ signalExpectations, signalObservations }));
}

function zeroRefresh(runId, nestedRunId, round = 1) {
  return {
    expectations: [
      expectation(
        round,
        'conformance',
        'architecture-conformance-auditor',
        `scope-r${round}`,
        'ACTIONABLE FINDINGS',
      ),
      expectation(round, 'synthesize-draft', 'architecture-audit-synthesizer', 'draft', 'SYNTH'),
    ],
    observations: [
      observation(
        round,
        'conformance',
        'architecture-conformance-auditor',
        `scope-r${round}`,
        'ACTIONABLE FINDINGS: 0',
      ),
      observation(
        round,
        'synthesize-draft',
        'architecture-audit-synthesizer',
        'draft',
        'SYNTH: stage=draft material=0 blocker=0 high=0 medium=0 low=1 rejected=0 unverified=0',
      ),
    ],
    nested: { round, runId: nestedRunId },
    runId,
  };
}

describe('architecture-refresh runtime signal floor', () => {
  it('is registered in the aggregate harness', () => {
    // `objectContaining`, not an exact shape: every entry also carries `examines`/`always`
    // (PROC-016), and this test pins registration, not the whole registry row.
    expect(SCAN_COMMANDS).toContainEqual(
      expect.objectContaining({
        name: 'architecture-refresh-signals',
        command: ['node', 'scripts/harness/scan-architecture-refresh-signals.mjs'],
      }),
    );
  });

  it('reports the exact number of ledger records examined and resets between scans', () => {
    const root = workspace();
    writeLedger(root, 'architecture-audit-fanout', [fanoutRun('fanout-a'), fanoutRun('fanout-b')]);
    findArchitectureRefreshSignalFindings(root);
    expect(examinedArchitectureRunCount()).toBe(2);

    writeLedger(root, 'architecture-audit-fanout', [fanoutRun('fanout-c')]);
    findArchitectureRefreshSignalFindings(root);
    expect(examinedArchitectureRunCount()).toBe(1);

    const missingLedgers = workspace();
    const proofFloors = findRawArchitectureRefreshSignalFindings(missingLedgers).filter(
      (finding) => finding.runId === '(proof-floor)',
    );
    expect(proofFloors.map((finding) => finding.ledger).sort()).toEqual([
      'architecture-audit-fanout.jsonl',
      'architecture-refresh.jsonl',
    ]);
  });

  it('accepts exact four-dimension manifests and rejects missing signals or omitted shards', () => {
    const root = workspace();
    const complete = fanoutRun();
    writeLedger(root, 'architecture-audit-fanout', [complete]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    const missing = structuredClone(complete);
    missing.extensions.architectureRefresh.signalObservations.shift();
    writeLedger(root, 'architecture-audit-fanout', [missing]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((f) => /exactly one/.test(f.detail)),
    ).toBe(true);

    const duplicate = structuredClone(complete);
    duplicate.extensions.architectureRefresh.signalObservations.push(
      structuredClone(duplicate.extensions.architectureRefresh.signalObservations[0]),
    );
    writeLedger(root, 'architecture-audit-fanout', [duplicate]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /has 2 observation/.test(finding.detail),
      ),
    ).toBe(true);

    const malformed = structuredClone(complete);
    malformed.extensions.architectureRefresh.signalObservations[0].signal =
      'AUDIT-DIM-COMPLETE: malformed';
    writeLedger(root, 'architecture-audit-fanout', [malformed]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /malformed AUDIT-DIM-COMPLETE/.test(finding.detail),
      ),
    ).toBe(true);

    const misattributed = structuredClone(complete);
    misattributed.extensions.architectureRefresh.signalObservations[0].signal =
      'AUDIT-DIM-COMPLETE: dim=design shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=1/1 uncovered=none';
    writeLedger(root, 'architecture-audit-fanout', [misattributed]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /misattributed AUDIT-DIM-COMPLETE/.test(finding.detail),
      ),
    ).toBe(true);

    const omittedShard = structuredClone(complete);
    const structure = omittedShard.extensions.architectureRefresh.signalExpectations[0];
    structure.subject = 'structure:1/2';
    omittedShard.extensions.architectureRefresh.signalObservations[0].subject = 'structure:1/2';
    omittedShard.extensions.architectureRefresh.signalObservations[0].signal =
      'AUDIT-DIM-COMPLETE: dim=structure shard=1/2 blocker=0 high=0 medium=0 low=0 coverage=1/1 uncovered=none';
    writeLedger(root, 'architecture-audit-fanout', [omittedShard]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((f) => /omits.*shards/.test(f.detail)),
    ).toBe(true);

    const duplicateCell = fanoutRun();
    duplicateCell.extensions.architectureRefresh.signalExpectations[0].subject = 'structure:1/2';
    duplicateCell.extensions.architectureRefresh.signalExpectations[0].cells = [
      'structure:target:c1',
    ];
    duplicateCell.extensions.architectureRefresh.signalObservations[0].subject = 'structure:1/2';
    duplicateCell.extensions.architectureRefresh.signalObservations[0].signal =
      'AUDIT-DIM-COMPLETE: dim=structure shard=1/2 blocker=0 high=0 medium=0 low=0 coverage=1/1 uncovered=none';
    duplicateCell.extensions.architectureRefresh.signalExpectations.push(
      expectation(
        1,
        'audit',
        'architecture-structure-auditor',
        'structure:2/2',
        'AUDIT-DIM-COMPLETE',
        ['structure:target:c1'],
      ),
    );
    duplicateCell.extensions.architectureRefresh.signalObservations.push(
      observation(
        1,
        'audit',
        'architecture-structure-auditor',
        'structure:2/2',
        'AUDIT-DIM-COMPLETE: dim=structure shard=2/2 blocker=0 high=0 medium=0 low=0 coverage=1/1 uncovered=none',
      ),
    );
    writeLedger(root, 'architecture-audit-fanout', [duplicateCell]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /assigns cell.*more than one shard/.test(finding.detail),
      ),
    ).toBe(true);

    const invalidRound = fanoutRun();
    for (const field of ['signalExpectations', 'signalObservations']) {
      for (const item of invalidRound.extensions.architectureRefresh[field]) item.round = 0;
    }
    writeLedger(root, 'architecture-audit-fanout', [invalidRound]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /invalid round 0/.test(finding.detail),
      ),
    ).toBe(true);

    const missingMiddleRound = fanoutRun();
    const middleMetadata = missingMiddleRound.extensions.architectureRefresh;
    middleMetadata.signalExpectations.push(
      ...middleMetadata.signalExpectations.map((item) => ({ ...structuredClone(item), round: 3 })),
    );
    middleMetadata.signalObservations.push(
      ...middleMetadata.signalObservations.map((item) => ({ ...structuredClone(item), round: 3 })),
    );
    missingMiddleRound.roundFindings = [0, 999, 0];
    writeLedger(root, 'architecture-audit-fanout', [missingMiddleRound]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /fanout round 2 has no attributable expectation metadata/.test(finding.detail),
      ),
    ).toBe(true);
  });

  it('accepts a two-round selective retry and rejects redispatch outside prior uncovered cells', () => {
    const root = workspace();
    const run = fanoutRun();
    const extension = run.extensions.architectureRefresh;
    extension.signalExpectations[0].cells = ['structure:a', 'structure:b'];
    extension.signalObservations[0].signal =
      'AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=1/2 uncovered=structure:b';
    extension.signalExpectations.push(
      expectation(
        2,
        'audit',
        'architecture-structure-auditor',
        'structure:1/1',
        'AUDIT-DIM-COMPLETE',
        ['structure:b'],
      ),
    );
    extension.signalObservations.push(
      observation(
        2,
        'audit',
        'architecture-structure-auditor',
        'structure:1/1',
        'AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=1/1 uncovered=none',
      ),
    );
    run.roundFindings = [1, 0];
    writeLedger(root, 'architecture-audit-fanout', [run]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    extension.signalExpectations.at(-1).cells = ['structure:a'];
    writeLedger(root, 'architecture-audit-fanout', [run]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((f) => /not exactly/.test(f.detail)),
    ).toBe(true);

    const omittedRetrySubject = fanoutRun();
    const omittedMetadata = omittedRetrySubject.extensions.architectureRefresh;
    omittedMetadata.signalExpectations[0].cells = ['structure:a'];
    omittedMetadata.signalObservations[0].signal =
      'AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=0/1 uncovered=structure:a';
    omittedMetadata.signalExpectations[1].cells = ['design:b'];
    omittedMetadata.signalObservations[1].signal =
      'AUDIT-DIM-COMPLETE: dim=design shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=0/1 uncovered=design:b';
    omittedMetadata.signalExpectations.push(
      expectation(
        2,
        'audit',
        'architecture-structure-auditor',
        'structure:1/1',
        'AUDIT-DIM-COMPLETE',
        ['structure:a'],
      ),
    );
    omittedMetadata.signalObservations.push(
      observation(
        2,
        'audit',
        'architecture-structure-auditor',
        'structure:1/1',
        'AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=0/1 uncovered=structure:a',
      ),
    );
    omittedRetrySubject.roundFindings = [2, 1];
    omittedRetrySubject.terminal = 'abandoned';
    writeLedger(root, 'architecture-audit-fanout', [omittedRetrySubject]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /retry subjects do not exactly equal/.test(finding.detail),
      ),
    ).toBe(true);
  });

  it('accepts a progressing three-round bound and requires an unchanged set to stop immediately', () => {
    const root = workspace();
    const bounded = fanoutRun();
    const extension = bounded.extensions.architectureRefresh;
    extension.signalExpectations[0].cells = [
      'structure:a',
      'structure:b',
      'structure:c',
      'structure:d',
    ];
    extension.signalObservations[0].signal =
      'AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=1/4 uncovered=structure:b;structure:c;structure:d';
    extension.signalExpectations.push(
      expectation(
        2,
        'audit',
        'architecture-structure-auditor',
        'structure:1/1',
        'AUDIT-DIM-COMPLETE',
        ['structure:b', 'structure:c', 'structure:d'],
      ),
      expectation(
        3,
        'audit',
        'architecture-structure-auditor',
        'structure:1/1',
        'AUDIT-DIM-COMPLETE',
        ['structure:c', 'structure:d'],
      ),
    );
    extension.signalObservations.push(
      observation(
        2,
        'audit',
        'architecture-structure-auditor',
        'structure:1/1',
        'AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=1/3 uncovered=structure:c;structure:d',
      ),
      observation(
        3,
        'audit',
        'architecture-structure-auditor',
        'structure:1/1',
        'AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=1/2 uncovered=structure:d',
      ),
    );
    bounded.roundFindings = [3, 2, 1];
    bounded.terminal = 'bound-reached';
    writeLedger(root, 'architecture-audit-fanout', [bounded]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    const fanoutSkill = path.join(root, '.agents/skills/architecture-audit-fanout/SKILL.md');
    writeFileSync(
      fanoutSkill,
      readFileSync(fanoutSkill, 'utf8').replace('bound=3 rounds', 'bound=4 rounds'),
      'utf8',
    );
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /owning skill's 4-round bound/.test(finding.detail),
      ),
    ).toBe(true);
    writeFileSync(
      fanoutSkill,
      readFileSync(fanoutSkill, 'utf8').replace('bound=4 rounds', 'bound=3 rounds'),
      'utf8',
    );

    const stalled = structuredClone(bounded);
    stalled.extensions.architectureRefresh.signalExpectations[2].cells = [
      'structure:c',
      'structure:d',
    ];
    stalled.extensions.architectureRefresh.signalObservations[2].signal =
      'AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=0/2 uncovered=structure:c;structure:d';
    stalled.roundFindings = [3, 2, 2];
    writeLedger(root, 'architecture-audit-fanout', [stalled]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /failed to stop at round 3/.test(finding.detail),
      ),
    ).toBe(true);
  });

  it('accepts a zero-material outer round and refuses an open silent run', () => {
    const root = workspace();
    writeLedger(root, 'architecture-audit-fanout', [fanoutRun()]);
    const zero = zeroRefresh('refresh-r1', 'fanout-r1');
    const outer = entry(
      'refresh-r1',
      [0],
      'converged',
      metadata({
        signalExpectations: zero.expectations,
        signalObservations: zero.observations,
        nestedRuns: [zero.nested],
      }),
    );
    writeLedger(root, 'architecture-refresh', [outer]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    const unknownPair = structuredClone(outer);
    unknownPair.extensions.architectureRefresh.signalExpectations.push(
      expectation(1, 'foo', 'foo', 'foo', 'BOGUS'),
    );
    unknownPair.extensions.architectureRefresh.signalObservations.push(
      observation(1, 'foo', 'foo', 'foo', 'BOGUS: anything'),
    );
    writeLedger(root, 'architecture-refresh', [unknownPair]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /outside the conformance\/synthesis\/verify\/depth\/reconcile protocol/.test(
          finding.detail,
        ),
      ),
    ).toBe(true);

    const inconsistentDraft = structuredClone(outer);
    inconsistentDraft.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('SYNTH: stage=draft '),
    ).signal =
      'SYNTH: stage=draft material=0 blocker=0 high=0 medium=0 low=1 rejected=0 unverified=999';
    writeLedger(root, 'architecture-refresh', [inconsistentDraft]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /draft SYNTH unverified must be zero/.test(finding.detail),
      ),
    ).toBe(true);

    const orphan = structuredClone(outer);
    orphan.extensions.architectureRefresh.finalFindings.push({
      round: 2,
      id: 'ORPHAN',
      severity: 'high',
    });
    writeLedger(root, 'architecture-refresh', [orphan]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /orphan round 2/.test(finding.detail),
      ),
    ).toBe(true);

    const prohibitedDownstream = structuredClone(outer);
    prohibitedDownstream.extensions.architectureRefresh.signalExpectations.push(
      expectation(1, 'verify', 'finding-verifier', 'F-zero', 'VERIFY'),
    );
    prohibitedDownstream.extensions.architectureRefresh.signalObservations.push(
      observation(
        1,
        'verify',
        'finding-verifier',
        'F-zero',
        'VERIFY: id=F-zero outcome=REFUTED severity-opinion=unchanged',
      ),
    );
    writeLedger(root, 'architecture-refresh', [prohibitedDownstream]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /zero-material draft carries prohibited downstream work/.test(finding.detail),
      ),
    ).toBe(true);

    const secondFanout = fanoutRun('fanout-second-clean');
    secondFanout.opened = '2026-08-22T00:03:00.000Z';
    secondFanout.closed = '2026-08-22T00:05:00.000Z';
    writeLedger(root, 'architecture-audit-fanout', [fanoutRun(), secondFanout]);
    const emptyNoProgress = structuredClone(outer);
    const emptyMetadata = emptyNoProgress.extensions.architectureRefresh;
    emptyMetadata.signalExpectations.push(
      ...emptyMetadata.signalExpectations.map((item) => ({ ...structuredClone(item), round: 2 })),
    );
    emptyMetadata.signalObservations.push(
      ...emptyMetadata.signalObservations.map((item) => ({ ...structuredClone(item), round: 2 })),
    );
    emptyMetadata.nestedRuns.push({ round: 2, runId: 'fanout-second-clean' });
    emptyNoProgress.roundFindings = [0, 0];
    emptyNoProgress.terminal = 'no-progress';
    emptyNoProgress.closed = '2026-08-22T00:06:00.000Z';
    writeLedger(root, 'architecture-refresh', [emptyNoProgress]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /empty final material set and must converge/.test(finding.detail),
      ),
    ).toBe(true);

    const open = fanoutRun('fanout-open');
    open.closed = null;
    open.terminal = null;
    open.roundFindings = [];
    open.extensions.architectureRefresh.signalObservations = [];
    writeLedger(root, 'architecture-audit-fanout', [open]);
    expect(findArchitectureRefreshSignalFindings(root).some((f) => /OPEN/.test(f.detail))).toBe(
      true,
    );
  });

  it('validates exact verifier transformation, depth outcomes, reconciliation, and two-round convergence', () => {
    const root = workspace();
    const firstFanout = fanoutRun('fanout-r1');
    const secondFanout = fanoutRun('fanout-r2');
    secondFanout.opened = '2026-08-22T00:03:00.000Z';
    secondFanout.closed = '2026-08-22T00:05:00.000Z';
    writeLedger(root, 'architecture-audit-fanout', [firstFanout, secondFanout]);
    mkdirSync(path.join(root, '.agents/tasks'), { recursive: true });
    writeFileSync(path.join(root, '.agents/tasks/INFRA-1-root.md'), '# INFRA-1\n', 'utf8');
    mkdirSync(path.join(root, '.agents/claims'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/claims/architecture.md'),
      'F-3 is tracked by the root item.\n> **Contained — INFRA-1.**\n',
      'utf8',
    );

    const zero = zeroRefresh('refresh-r1', 'fanout-r2', 2);
    const signalExpectations = [
      expectation(
        1,
        'conformance',
        'architecture-conformance-auditor',
        'scope-r1',
        'ACTIONABLE FINDINGS',
      ),
      expectation(1, 'synthesize-draft', 'architecture-audit-synthesizer', 'draft', 'SYNTH'),
      expectation(1, 'verify', 'finding-verifier', 'F-1', 'VERIFY'),
      expectation(1, 'verify', 'finding-verifier', 'F-2', 'VERIFY'),
      expectation(1, 'verify', 'finding-verifier', 'F-3', 'VERIFY'),
      expectation(1, 'synthesize-final', 'architecture-audit-synthesizer', 'final', 'SYNTH'),
      expectation(1, 'depth', 'finding-depth-triager', 'F-1', 'DEPTH'),
      expectation(1, 'depth', 'finding-depth-triager', 'F-3', 'DEPTH'),
      expectation(1, 'reconcile', 'finding-reconciler', 'F-3', 'RECONCILE'),
      ...zero.expectations,
    ];
    const signalObservations = [
      observation(
        1,
        'conformance',
        'architecture-conformance-auditor',
        'scope-r1',
        'ACTIONABLE FINDINGS: 0',
      ),
      observation(
        1,
        'synthesize-draft',
        'architecture-audit-synthesizer',
        'draft',
        'SYNTH: stage=draft material=3 blocker=1 high=1 medium=1 low=1 rejected=0 unverified=0',
      ),
      observation(
        1,
        'verify',
        'finding-verifier',
        'F-1',
        'VERIFY: id=F-1 outcome=CONFIRMED severity-opinion=medium',
      ),
      observation(
        1,
        'verify',
        'finding-verifier',
        'F-2',
        'VERIFY: id=F-2 outcome=REFUTED severity-opinion=unchanged',
      ),
      observation(
        1,
        'verify',
        'finding-verifier',
        'F-3',
        'VERIFY: id=F-3 outcome=CONFIRMED severity-opinion=unchanged',
      ),
      observation(
        1,
        'synthesize-final',
        'architecture-audit-synthesizer',
        'final',
        'SYNTH: stage=final material=2 blocker=1 high=0 medium=1 low=1 rejected=1 unverified=0',
      ),
      observation(1, 'depth', 'finding-depth-triager', 'F-1', 'DEPTH: id=F-1 outcome=LOCAL'),
      observation(1, 'depth', 'finding-depth-triager', 'F-3', 'DEPTH: id=F-3 outcome=FOUNDATIONAL'),
      observation(
        1,
        'reconcile',
        'finding-reconciler',
        'F-3',
        'RECONCILE: id=F-3 outcome=KNOWN target=INFRA-1',
      ),
      ...zero.observations,
    ];
    const outer = entry(
      'refresh-r1',
      [2, 0],
      'converged',
      metadata({
        signalExpectations,
        signalObservations,
        verificationPassThroughIds: [],
        draftFindings: [
          { round: 1, id: 'F-1', severity: 'high' },
          { round: 1, id: 'F-2', severity: 'medium' },
          { round: 1, id: 'F-3', severity: 'blocker' },
        ],
        finalFindings: [
          { round: 1, id: 'F-1', severity: 'medium' },
          { round: 1, id: 'F-3', severity: 'blocker' },
        ],
        foundationalIds: [{ round: 1, id: 'F-3' }],
        reconciliationRoutes: [
          {
            round: 1,
            id: 'F-3',
            action: 'reused',
            target: 'INFRA-1',
            site: null,
            evidence: null,
          },
        ],
        dispositions: [
          { round: 1, id: 'F-1', outcome: 'corrected', target: null },
          {
            round: 1,
            id: 'F-3',
            outcome: 'contained',
            target: 'INFRA-1',
            site: '.agents/claims/architecture.md',
            evidence: 'F-3',
          },
        ],
        nestedRuns: [{ round: 1, runId: 'fanout-r1' }, zero.nested],
      }),
    );
    outer.closed = '2026-08-22T00:06:00.000Z';
    writeLedger(root, 'architecture-refresh', [outer]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    const retrospective = structuredClone(outer);
    retrospective.opened = '2026-08-22T00:00:01.000Z';
    writeLedger(root, 'architecture-refresh', [retrospective]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /nested fanout opened before its outer run/.test(finding.detail),
      ),
    ).toBe(true);

    const closedTooSoon = structuredClone(outer);
    closedTooSoon.closed = '2026-08-22T00:04:00.000Z';
    writeLedger(root, 'architecture-refresh', [closedTooSoon]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /nested fanout closed after its outer run/.test(finding.detail),
      ),
    ).toBe(true);

    writeFileSync(
      path.join(root, '.agents/claims/architecture.md'),
      'The containment label is missing.\n',
      'utf8',
    );
    writeLedger(root, 'architecture-refresh', [outer]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /has no claim-adjacent.*Contained/.test(finding.detail),
      ),
    ).toBe(true);
    const selfProvingContainment = structuredClone(outer);
    selfProvingContainment.extensions.architectureRefresh.dispositions.find(
      (item) => item.id === 'F-3',
    ).evidence = 'Contained — INFRA-1.';
    writeFileSync(
      path.join(root, '.agents/claims/architecture.md'),
      '> **Contained — INFRA-1.**\n',
      'utf8',
    );
    writeLedger(root, 'architecture-refresh', [selfProvingContainment]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /has no claim-adjacent.*Contained/.test(finding.detail),
      ),
    ).toBe(true);
    writeFileSync(
      path.join(root, '.agents/claims/architecture.md'),
      'F-3 is the claim.\nUnrelated text.\n> **Contained — INFRA-1.**\n',
      'utf8',
    );
    writeLedger(root, 'architecture-refresh', [outer]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /has no claim-adjacent.*Contained/.test(finding.detail),
      ),
    ).toBe(true);
    writeFileSync(
      path.join(root, '.agents/claims/architecture.md'),
      'F-3 is tracked by the root item.\n> **Contained — INFRA-1.**\n',
      'utf8',
    );

    const inconsistentSynth = structuredClone(outer);
    inconsistentSynth.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('SYNTH: stage=draft '),
    ).signal =
      'SYNTH: stage=draft material=4 blocker=1 high=1 medium=1 low=1 rejected=0 unverified=0';
    writeLedger(root, 'architecture-refresh', [inconsistentSynth]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /draft SYNTH counts disagree/.test(finding.detail),
      ),
    ).toBe(true);

    const unresolved = structuredClone(outer);
    unresolved.extensions.architectureRefresh.dispositions =
      unresolved.extensions.architectureRefresh.dispositions.filter((item) => item.id !== 'F-1');
    writeLedger(root, 'architecture-refresh', [unresolved]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /converged with unresolved material identities/.test(finding.detail),
      ),
    ).toBe(true);

    const reusedNested = structuredClone(outer);
    reusedNested.extensions.architectureRefresh.nestedRuns[1].runId = 'fanout-r1';
    writeLedger(root, 'architecture-refresh', [reusedNested]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /reuses a nested fanout run/.test(finding.detail),
      ),
    ).toBe(true);

    const truncatedTarget = structuredClone(outer);
    truncatedTarget.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=KNOWN target=INFRA';
    truncatedTarget.extensions.architectureRefresh.dispositions.find(
      (item) => item.id === 'F-3',
    ).target = 'INFRA';
    writeLedger(root, 'architecture-refresh', [truncatedTarget]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /names no resolvable root item INFRA/.test(finding.detail),
      ),
    ).toBe(true);

    const invalidNewTarget = structuredClone(outer);
    invalidNewTarget.terminal = 'halted-for-user';
    invalidNewTarget.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=NEW target=bogus';
    invalidNewTarget.extensions.architectureRefresh.dispositions =
      invalidNewTarget.extensions.architectureRefresh.dispositions.filter(
        (item) => item.id !== 'F-3',
      );
    writeLedger(root, 'architecture-refresh', [invalidNewTarget]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /NEW F-3 must return target=none/.test(finding.detail),
      ),
    ).toBe(true);

    const invalidUnsureTarget = structuredClone(outer);
    invalidUnsureTarget.terminal = 'halted-for-user';
    invalidUnsureTarget.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=UNSURE target=BOGUS-999';
    invalidUnsureTarget.extensions.architectureRefresh.dispositions =
      invalidUnsureTarget.extensions.architectureRefresh.dispositions.filter(
        (item) => item.id !== 'F-3',
      );
    writeLedger(root, 'architecture-refresh', [invalidUnsureTarget]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /UNSURE F-3 names unresolved candidate targets/.test(finding.detail),
      ),
    ).toBe(true);

    mkdirSync(path.join(root, '.agents/tasks/ARCH-9-not-a-task.md'));
    const directoryCandidate = structuredClone(invalidUnsureTarget);
    directoryCandidate.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=UNSURE target=ARCH-9';
    writeLedger(root, 'architecture-refresh', [directoryCandidate]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /UNSURE F-3 names unresolved candidate targets/.test(finding.detail),
      ),
    ).toBe(true);

    writeFileSync(path.join(root, '.agents/tasks/ARCH-11-not-a-task.txt'), '# ARCH-11\n', 'utf8');
    const nonMarkdownCandidate = structuredClone(invalidUnsureTarget);
    nonMarkdownCandidate.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=UNSURE target=ARCH-11';
    writeLedger(root, 'architecture-refresh', [nonMarkdownCandidate]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /UNSURE F-3 names unresolved candidate targets/.test(finding.detail),
      ),
    ).toBe(true);

    const externalTask = path.join(root, 'ARCH-10-external.md');
    writeFileSync(externalTask, '# ARCH-10\n', 'utf8');
    symlinkSync(externalTask, path.join(root, '.agents/tasks/ARCH-10-link.md'));
    const symlinkCandidate = structuredClone(invalidUnsureTarget);
    symlinkCandidate.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=UNSURE target=ARCH-10';
    writeLedger(root, 'architecture-refresh', [symlinkCandidate]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /UNSURE F-3 names unresolved candidate targets/.test(finding.detail),
      ),
    ).toBe(true);

    const unsureWithoutRegistryEvidence = structuredClone(outer);
    unsureWithoutRegistryEvidence.terminal = 'halted-for-user';
    unsureWithoutRegistryEvidence.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=UNSURE target=none';
    unsureWithoutRegistryEvidence.extensions.architectureRefresh.dispositions =
      unsureWithoutRegistryEvidence.extensions.architectureRefresh.dispositions.filter(
        (item) => item.id !== 'F-3',
      );
    unsureWithoutRegistryEvidence.extensions.architectureRefresh.reconciliationRoutes = [];
    writeLedger(root, 'architecture-refresh', [unsureWithoutRegistryEvidence]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    const invalidDisposition = structuredClone(outer);
    invalidDisposition.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('DEPTH: id=F-1 '),
    ).signal = 'DEPTH: id=F-1 outcome=INVALID';
    invalidDisposition.extensions.architectureRefresh.dispositions =
      invalidDisposition.extensions.architectureRefresh.dispositions.map((item) =>
        item.id === 'F-1'
          ? {
              round: 1,
              id: 'F-1',
              outcome: 'invalid',
              target: null,
              site: '.agents/claims/architecture.md',
              evidence: 'F-3 is tracked by the root item.',
            }
          : item,
      );
    writeLedger(root, 'architecture-refresh', [invalidDisposition]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);
    invalidDisposition.extensions.architectureRefresh.dispositions.find(
      (item) => item.id === 'F-1',
    ).evidence = 'not present in the source';
    writeLedger(root, 'architecture-refresh', [invalidDisposition]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /INVALID F-1 lacks source-site evidence/.test(finding.detail),
      ),
    ).toBe(true);

    const undetermined = structuredClone(outer);
    undetermined.terminal = 'halted-for-user';
    undetermined.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('DEPTH: id=F-1 '),
    ).signal = 'DEPTH: id=F-1 outcome=UNDETERMINED';
    undetermined.extensions.architectureRefresh.dispositions =
      undetermined.extensions.architectureRefresh.dispositions.filter((item) => item.id !== 'F-1');
    writeLedger(root, 'architecture-refresh', [undetermined]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    writeFileSync(path.join(root, '.agents/tasks/ARCH-2-new-root.md'), '# ARCH-2\n', 'utf8');
    const foundationalNew = structuredClone(outer);
    foundationalNew.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=NEW target=none';
    foundationalNew.extensions.architectureRefresh.dispositions.find(
      (item) => item.id === 'F-3',
    ).target = 'ARCH-2';
    foundationalNew.extensions.architectureRefresh.reconciliationRoutes = [
      {
        round: 1,
        id: 'F-3',
        action: 'filed',
        target: 'ARCH-2',
        site: '.agents/tasks/ARCH-2-new-root.md',
        evidence: '# ARCH-2',
      },
    ];
    writeFileSync(
      path.join(root, '.agents/claims/architecture.md'),
      'F-3 is tracked by the new root item.\n> **Contained — ARCH-2.**\n',
      'utf8',
    );
    writeLedger(root, 'architecture-refresh', [foundationalNew]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    mkdirSync(path.join(root, '.agents/claims'), { recursive: true });
    writeFileSync(path.join(root, '.agents/claims/ARCH-2.md'), '# ARCH-2\n', 'utf8');
    const traversalRoute = structuredClone(foundationalNew);
    traversalRoute.extensions.architectureRefresh.reconciliationRoutes[0].site =
      '.agents/tasks/../claims/ARCH-2.md';
    writeLedger(root, 'architecture-refresh', [traversalRoute]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /NEW F-3 lacks filed-task evidence/.test(finding.detail),
      ),
    ).toBe(true);

    writeFileSync(
      path.join(root, '.agents/tasks/ARCH-3-existing-root.md'),
      '# ARCH-3\n\nExtended for F-3.\n',
      'utf8',
    );
    const foundationalExtends = structuredClone(outer);
    foundationalExtends.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=EXTENDS target=ARCH-3';
    foundationalExtends.extensions.architectureRefresh.dispositions.find(
      (item) => item.id === 'F-3',
    ).target = 'ARCH-3';
    foundationalExtends.extensions.architectureRefresh.reconciliationRoutes = [
      {
        round: 1,
        id: 'F-3',
        action: 'updated',
        target: 'ARCH-3',
        site: '.agents/tasks/ARCH-3-existing-root.md',
        evidence: 'Extended for F-3.',
      },
    ];
    writeFileSync(
      path.join(root, '.agents/claims/architecture.md'),
      'F-3 extends the existing root item.\n> **Contained — ARCH-3.**\n',
      'utf8',
    );
    writeLedger(root, 'architecture-refresh', [foundationalExtends]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    writeFileSync(path.join(root, '.agents/tasks/ARCH-3-proof.txt'), 'Extended for F-3.\n', 'utf8');
    const nonTaskRouteEvidence = structuredClone(foundationalExtends);
    nonTaskRouteEvidence.extensions.architectureRefresh.reconciliationRoutes[0].site =
      '.agents/tasks/ARCH-3-proof.txt';
    writeLedger(root, 'architecture-refresh', [nonTaskRouteEvidence]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /EXTENDS F-3 lacks task-update evidence/.test(finding.detail),
      ),
    ).toBe(true);

    const foundationalUnsure = structuredClone(outer);
    foundationalUnsure.terminal = 'halted-for-user';
    foundationalUnsure.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('RECONCILE: id=F-3 '),
    ).signal = 'RECONCILE: id=F-3 outcome=UNSURE target=INFRA-1';
    foundationalUnsure.extensions.architectureRefresh.dispositions =
      foundationalUnsure.extensions.architectureRefresh.dispositions.filter(
        (item) => item.id !== 'F-3',
      );
    foundationalUnsure.extensions.architectureRefresh.reconciliationRoutes = [];
    writeFileSync(
      path.join(root, '.agents/claims/architecture.md'),
      'F-3 is tracked by the root item.\n> **Contained — INFRA-1.**\n',
      'utf8',
    );
    writeLedger(root, 'architecture-refresh', [foundationalUnsure]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    // Issue #2170 — a run that stopped short is validated against the phase it stopped at, never
    // against the terminal string alone.
    const stripToRound = (record, keepRound) => {
      const partial = record.extensions.architectureRefresh;
      for (const field of Object.keys(partial)) {
        if (Array.isArray(partial[field])) {
          partial[field] = partial[field].filter((item) => item.round <= keepRound);
        }
      }
      record.roundFindings = record.roundFindings.slice(0, keepRound);
      return record;
    };
    const detailMatching = (pattern) =>
      findArchitectureRefreshSignalFindings(root).some((finding) => pattern.test(finding.detail));

    const abandonedMidDepth = stripToRound(structuredClone(outer), 1);
    abandonedMidDepth.terminal = 'abandoned';
    abandonedMidDepth.extensions.architectureRefresh.signalObservations =
      abandonedMidDepth.extensions.architectureRefresh.signalObservations.filter(
        (item) => !item.signal.startsWith('DEPTH: id=F-1 '),
      );
    abandonedMidDepth.extensions.architectureRefresh.dispositions =
      abandonedMidDepth.extensions.architectureRefresh.dispositions.filter(
        (item) => item.id !== 'F-1',
      );
    // No checkpoint: `abandoned` waives nothing, and the record says why.
    writeLedger(root, 'architecture-refresh', [abandonedMidDepth]);
    expect(detailMatching(/abandoned run records no checkpoint/)).toBe(true);
    expect(detailMatching(/DEPTH identities do not equal the final material ID set/)).toBe(true);
    // Interrupted during per-finding routing, after final synthesis: depth may be partial.
    abandonedMidDepth.extensions.architectureRefresh.checkpoint = {
      round: 1,
      phase: 'synthesize-final',
    };
    writeLedger(root, 'architecture-refresh', [abandonedMidDepth]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    // Claimed interruption BEFORE synthesis, while carrying draft/verify/final evidence: fail
    // closed. Draft synthesis is the phase in progress after `conformance`, so it may be partial;
    // verification and everything after it cannot exist.
    const claimedEarlier = structuredClone(abandonedMidDepth);
    claimedEarlier.extensions.architectureRefresh.checkpoint = { round: 1, phase: 'conformance' };
    writeLedger(root, 'architecture-refresh', [claimedEarlier]);
    expect(detailMatching(/verify evidence beyond checkpoint conformance/)).toBe(true);
    expect(detailMatching(/depth evidence beyond checkpoint conformance/)).toBe(true);
    // A run that honestly stopped there — only conformance evidence — passes.
    const stoppedBeforeSynthesis = structuredClone(claimedEarlier);
    const stoppedMetadata = stoppedBeforeSynthesis.extensions.architectureRefresh;
    stoppedMetadata.signalExpectations = stoppedMetadata.signalExpectations.filter(
      (item) => item.phase === 'conformance',
    );
    stoppedMetadata.signalObservations = stoppedMetadata.signalObservations.filter(
      (item) => item.phase === 'conformance',
    );
    for (const field of [
      'draftFindings',
      'finalFindings',
      'foundationalIds',
      'reconciliationRoutes',
      'dispositions',
      'verificationPassThroughIds',
    ]) {
      stoppedMetadata[field] = [];
    }
    stoppedBeforeSynthesis.roundFindings = [];
    writeLedger(root, 'architecture-refresh', [stoppedBeforeSynthesis]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    // Audit-through-reconciliation: every finding judged and routed, nothing applied, escalated.
    const auditOnly = stripToRound(structuredClone(outer), 1);
    auditOnly.terminal = 'halted-for-user';
    auditOnly.extensions.architectureRefresh.dispositions = [];
    auditOnly.extensions.architectureRefresh.checkpoint = { round: 1, phase: 'reconcile' };
    writeLedger(root, 'architecture-refresh', [auditOnly]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);
    // ...and that checkpoint does not waive a DEPTH verdict, which sits at or before it.
    const auditOnlyShortOfDepth = structuredClone(auditOnly);
    auditOnlyShortOfDepth.extensions.architectureRefresh.signalObservations =
      auditOnlyShortOfDepth.extensions.architectureRefresh.signalObservations.filter(
        (item) => !item.signal.startsWith('DEPTH: id=F-1 '),
      );
    writeLedger(root, 'architecture-refresh', [auditOnlyShortOfDepth]);
    expect(detailMatching(/DEPTH identities do not equal the final material ID set/)).toBe(true);
    // The exploit the issue measured: the same omission under `abandoned`, by the word alone.
    const dispositionsOmitted = structuredClone(auditOnly);
    dispositionsOmitted.terminal = 'abandoned';
    dispositionsOmitted.extensions.architectureRefresh.checkpoint = null;
    writeLedger(root, 'architecture-refresh', [dispositionsOmitted]);
    expect(detailMatching(/records no checkpoint/)).toBe(true);
    expect(detailMatching(/LOCAL F-1 must be corrected/)).toBe(true);
    expect(detailMatching(/FOUNDATIONAL F-3 must be contained/)).toBe(true);

    // A checkpoint on a run that claims the whole loop is a contradiction.
    const convergedWithCheckpoint = structuredClone(outer);
    convergedWithCheckpoint.extensions.architectureRefresh.checkpoint = {
      round: 1,
      phase: 'disposition',
    };
    writeLedger(root, 'architecture-refresh', [convergedWithCheckpoint]);
    expect(detailMatching(/checkpoint disposition is recorded on a run closed `converged`/)).toBe(
      true,
    );
    // Evidence in a round after the checkpoint's proves the run continued past it.
    const continuedPastCheckpoint = structuredClone(outer);
    continuedPastCheckpoint.terminal = 'abandoned';
    continuedPastCheckpoint.extensions.architectureRefresh.checkpoint = {
      round: 1,
      phase: 'disposition',
    };
    writeLedger(root, 'architecture-refresh', [continuedPastCheckpoint]);
    expect(detailMatching(/round 2 carries .* evidence beyond checkpoint round 1/)).toBe(true);

    const downgradedLow = structuredClone(outer);
    const downgradedMetadata = downgradedLow.extensions.architectureRefresh;
    downgradedMetadata.signalObservations.find((item) =>
      item.signal.startsWith('VERIFY: id=F-1 '),
    ).signal = 'VERIFY: id=F-1 outcome=CONFIRMED severity-opinion=low';
    downgradedMetadata.signalObservations.find((item) =>
      item.signal.startsWith('SYNTH: stage=final '),
    ).signal =
      'SYNTH: stage=final material=1 blocker=1 high=0 medium=0 low=2 rejected=1 unverified=0';
    downgradedMetadata.finalFindings = downgradedMetadata.finalFindings.filter(
      (item) => item.id !== 'F-1',
    );
    downgradedMetadata.signalExpectations = downgradedMetadata.signalExpectations.filter(
      (item) => !(item.token === 'DEPTH' && item.subject === 'F-1'),
    );
    downgradedMetadata.signalObservations = downgradedMetadata.signalObservations.filter(
      (item) => !item.signal.startsWith('DEPTH: id=F-1 '),
    );
    downgradedMetadata.dispositions = downgradedMetadata.dispositions.filter(
      (item) => item.id !== 'F-1',
    );
    downgradedLow.roundFindings = [1, 0];
    writeLedger(root, 'architecture-refresh', [downgradedLow]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    const unprovableLow = structuredClone(downgradedLow);
    unprovableLow.extensions.architectureRefresh.signalObservations.find((item) =>
      item.signal.startsWith('VERIFY: id=F-1 '),
    ).signal = 'VERIFY: id=F-1 outcome=UNPROVABLE severity-opinion=low';
    writeLedger(root, 'architecture-refresh', [unprovableLow]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    const highPassThrough = structuredClone(outer);
    highPassThrough.extensions.architectureRefresh.signalExpectations =
      highPassThrough.extensions.architectureRefresh.signalExpectations.filter(
        (item) => !(item.round === 1 && item.token === 'VERIFY' && item.subject === 'F-3'),
      );
    highPassThrough.extensions.architectureRefresh.signalObservations =
      highPassThrough.extensions.architectureRefresh.signalObservations.filter(
        (item) => !(item.round === 1 && item.signal.startsWith('VERIFY: id=F-3 ')),
      );
    highPassThrough.extensions.architectureRefresh.verificationPassThroughIds = [
      { round: 1, id: 'F-3' },
    ];
    highPassThrough.extensions.architectureRefresh.signalObservations.find(
      (item) => item.round === 1 && item.signal.startsWith('SYNTH: stage=final '),
    ).signal =
      'SYNTH: stage=final material=2 blocker=1 high=0 medium=1 low=1 rejected=1 unverified=1';
    writeLedger(root, 'architecture-refresh', [highPassThrough]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((f) =>
        /must be selected for VERIFY/.test(f.detail),
      ),
    ).toBe(true);

    const swapped = structuredClone(outer);
    swapped.extensions.architectureRefresh.finalFindings[0].id = 'F-2';
    writeLedger(root, 'architecture-refresh', [swapped]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((f) =>
        /verifier transformation/.test(f.detail),
      ),
    ).toBe(true);

    const noProgress = structuredClone(outer);
    const noProgressMetadata = noProgress.extensions.architectureRefresh;
    for (const field of [
      'signalExpectations',
      'signalObservations',
      'draftFindings',
      'finalFindings',
      'foundationalIds',
      'reconciliationRoutes',
      'dispositions',
    ]) {
      const roundOne = noProgressMetadata[field].filter((item) => item.round === 1);
      noProgressMetadata[field] = [
        ...roundOne,
        ...roundOne.map((item) => ({ ...structuredClone(item), round: 2 })),
      ];
    }
    noProgressMetadata.nestedRuns = [
      { round: 1, runId: 'fanout-r1' },
      { round: 2, runId: 'fanout-r2' },
    ];
    noProgress.roundFindings = [2, 2];
    noProgress.terminal = 'no-progress';
    writeLedger(root, 'architecture-refresh', [noProgress]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);

    const thirdFanout = fanoutRun('fanout-r3');
    thirdFanout.opened = '2026-08-22T00:07:00.000Z';
    thirdFanout.closed = '2026-08-22T00:09:00.000Z';
    writeLedger(root, 'architecture-audit-fanout', [firstFanout, secondFanout, thirdFanout]);
    const stalledThenClean = structuredClone(noProgress);
    const stalledMetadata = stalledThenClean.extensions.architectureRefresh;
    const cleanThird = zeroRefresh('refresh-r1', 'fanout-r3', 3);
    stalledMetadata.signalExpectations.push(...cleanThird.expectations);
    stalledMetadata.signalObservations.push(...cleanThird.observations);
    stalledMetadata.nestedRuns.push(cleanThird.nested);
    stalledThenClean.roundFindings = [2, 2, 0];
    stalledThenClean.terminal = 'converged';
    stalledThenClean.closed = '2026-08-22T00:10:00.000Z';
    writeLedger(root, 'architecture-refresh', [stalledThenClean]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /failed to stop at round 2 when final material set recurred/.test(finding.detail),
      ),
    ).toBe(true);

    noProgressMetadata.finalFindings.find((item) => item.round === 2 && item.id === 'F-1').id =
      'F-4';
    writeLedger(root, 'architecture-refresh', [noProgress]);
    expect(
      findArchitectureRefreshSignalFindings(root).some((finding) =>
        /no-progress.*without a repeated final material ID set/.test(finding.detail),
      ),
    ).toBe(true);
  });

  it('accepts an explicitly abandoned partial run but still validates returned observations', () => {
    const root = workspace();
    const partial = entry(
      'fanout-abandoned',
      [],
      'abandoned',
      metadata({
        signalExpectations: [
          expectation(
            1,
            'audit',
            'architecture-structure-auditor',
            'structure:1/1',
            'AUDIT-DIM-COMPLETE',
            ['structure:a'],
          ),
        ],
      }),
    );
    writeLedger(root, 'architecture-audit-fanout', [partial]);
    expect(findArchitectureRefreshSignalFindings(root)).toEqual([]);
    expect(
      findRawArchitectureRefreshSignalFindings(root).some(
        (finding) =>
          finding.runId === '(proof-floor)' &&
          /no complete signal-valid converged/.test(finding.detail),
      ),
    ).toBe(true);
  });
});
