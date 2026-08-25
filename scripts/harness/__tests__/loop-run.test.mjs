/**
 * HARNESS-112 — the recorder that makes `escape=no-progress` checkable.
 *
 * Every refusal is asserted in BOTH directions. A recorder that accepts any terminal reason records
 * a vocabulary rather than a fact, and a recorder that refuses everything is discovered only when
 * someone needs it. The pairs below are what separate the two.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  LEDGER_DIR,
  closeRun,
  ledgerSkills,
  main,
  openRun,
  permitsTerminal,
  readLedger,
  recordRound,
  recordDisposition,
  recordFoundationalId,
  recordReconciliationRoute,
  recordSignalExpectation,
  recordSignalObservation,
  recordVerificationPassThrough,
  linkNestedRun,
  terminalReasonNames,
} from '../loop-run.mjs';

/** A throwaway workspace whose only content is the skills this case needs. */
function workspace(skills) {
  const root = makeTemp('loop-run-');
  for (const [name, declaration] of Object.entries(skills)) {
    mkdirSync(path.join(root, '.agents/skills', name), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: fixture\nloop: ${declaration}\n---\n\n# ${name}\n\nRe-drive until the finding set stops changing.\n`,
      'utf8',
    );
  }
  return root;
}

const FINDING_SET = 'over=finding-set; escape=no-progress';
const ATTEMPT = 'over=attempt; bound=3 attempts';
const NOW = Date.parse('2026-08-19T01:00:00.000Z');

describe('openRun', () => {
  it('initializes a neutral extension seam without architecture fields on unrelated loops', () => {
    const root = workspace({ looper: FINDING_SET });
    const entry = openRun({ root, skill: 'looper', now: NOW });
    expect(entry.extensions).toEqual({});
    expect(entry).not.toHaveProperty('signalExpectations');
    expect(entry).not.toHaveProperty('nestedRunId');
  });

  it('appends an OPEN entry and refuses a skill that declares no loop', () => {
    const root = workspace({ looper: FINDING_SET });
    mkdirSync(path.join(root, '.agents/skills/plain'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills/plain/SKILL.md'),
      '---\nname: plain\n---\n\n# plain\n',
      'utf8',
    );

    const entry = openRun({ root, skill: 'looper', now: NOW });
    expect(entry.terminal).toBe(null);
    expect(readLedger(root, 'looper')).toHaveLength(1);
    expect(() => openRun({ root, skill: 'plain', now: NOW })).toThrow(/declares no `loop:`/);
  });

  it('refuses a second OPEN run, because two open runs cannot be told apart afterwards', () => {
    const root = workspace({ looper: FINDING_SET });
    openRun({ root, skill: 'looper', now: NOW });
    expect(() => openRun({ root, skill: 'looper', now: NOW })).toThrow(/already has run/);
  });
});

describe('recordRound', () => {
  it('makes the ARRAY the round count — no second stored number to diverge from it', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    recordRound({ root, skill: 'looper', runId, findings: 3 });
    const entry = recordRound({ root, skill: 'looper', runId, findings: 1 });
    expect(entry.roundFindings).toEqual([3, 1]);
    expect(Object.keys(entry)).not.toContain('rounds');
  });

  it('refuses a non-integer or negative finding count', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    expect(() => recordRound({ root, skill: 'looper', runId, findings: -1 })).toThrow(
      /non-negative integer/,
    );
    expect(() => recordRound({ root, skill: 'looper', runId, findings: 1.5 })).toThrow(
      /non-negative integer/,
    );
  });
});

describe('architecture signal metadata', () => {
  it('records one expectation and its exact terminal-line observation on an open run', () => {
    const root = workspace({ 'architecture-refresh': FINDING_SET });
    const { runId } = openRun({ root, skill: 'architecture-refresh', now: NOW });
    recordSignalExpectation({
      root,
      skill: 'architecture-refresh',
      runId,
      phase: 'conformance',
      agent: 'architecture-conformance-auditor',
      subject: 'scope',
      token: 'ACTIONABLE FINDINGS',
    });
    const entry = recordSignalObservation({
      root,
      skill: 'architecture-refresh',
      runId,
      phase: 'conformance',
      agent: 'architecture-conformance-auditor',
      subject: 'scope',
      signal: 'ACTIONABLE FINDINGS: 0',
    });
    expect(entry.extensions.architectureRefresh.signalExpectations).toEqual([
      {
        round: 1,
        phase: 'conformance',
        agent: 'architecture-conformance-auditor',
        subject: 'scope',
        token: 'ACTIONABLE FINDINGS',
      },
    ]);
    expect(entry.extensions.architectureRefresh.signalObservations[0].signal).toMatch(
      /^ACTIONABLE FINDINGS:/,
    );
  });

  it('rejects expectation tuples outside each architecture protocol vocabulary', () => {
    const root = workspace({ 'architecture-refresh': FINDING_SET });
    const { runId } = openRun({ root, skill: 'architecture-refresh', now: NOW });
    expect(() =>
      recordSignalExpectation({
        root,
        skill: 'architecture-refresh',
        runId,
        phase: 'foo',
        agent: 'foo',
        subject: 'foo',
        token: 'BOGUS',
      }),
    ).toThrow(/outside the conformance\/synthesis\/verify\/depth\/reconcile protocol/);
  });

  it('scopes routing and nested-run metadata to each round', () => {
    const root = workspace({ 'architecture-refresh': FINDING_SET });
    const { runId } = openRun({ root, skill: 'architecture-refresh', now: NOW });
    recordVerificationPassThrough({ root, skill: 'architecture-refresh', runId, id: 'F-1' });
    recordFoundationalId({ root, skill: 'architecture-refresh', runId, id: 'F-2' });
    recordReconciliationRoute({
      root,
      skill: 'architecture-refresh',
      runId,
      id: 'F-2',
      action: 'reused',
      target: 'INFRA-131',
    });
    recordDisposition({
      root,
      skill: 'architecture-refresh',
      runId,
      id: 'F-2',
      outcome: 'contained',
      target: 'INFRA-131',
      site: '.agents/specs/claim.md',
      evidence: 'F-2',
    });
    linkNestedRun({ root, skill: 'architecture-refresh', runId, nestedRunId: 'nested-r1' });
    recordRound({ root, skill: 'architecture-refresh', runId, findings: 1 });
    const entry = linkNestedRun({
      root,
      skill: 'architecture-refresh',
      runId,
      nestedRunId: 'nested-r2',
    });
    const metadata = entry.extensions.architectureRefresh;
    expect(metadata.verificationPassThroughIds).toEqual([{ round: 1, id: 'F-1' }]);
    expect(metadata.foundationalIds).toEqual([{ round: 1, id: 'F-2' }]);
    expect(metadata.reconciliationRoutes).toEqual([
      {
        round: 1,
        id: 'F-2',
        action: 'reused',
        target: 'INFRA-131',
        site: null,
        evidence: null,
      },
    ]);
    expect(metadata.dispositions).toEqual([
      {
        round: 1,
        id: 'F-2',
        outcome: 'contained',
        target: 'INFRA-131',
        site: '.agents/specs/claim.md',
        evidence: 'F-2',
      },
    ]);
    expect(metadata.nestedRuns).toEqual([
      { round: 1, runId: 'nested-r1' },
      { round: 2, runId: 'nested-r2' },
    ]);
  });

  it('rejects architecture protocol metadata on an unrelated loop', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    expect(() =>
      recordSignalExpectation({
        root,
        skill: 'looper',
        runId,
        phase: 'audit',
        agent: 'architecture-structure-auditor',
        subject: 'structure:1/1',
        token: 'AUDIT-DIM-COMPLETE',
      }),
    ).toThrow(/not owned/);

    const fanoutRoot = workspace({
      'architecture-audit-fanout': 'over=finding-set; escape=no-progress; bound=3 rounds',
    });
    const fanout = openRun({
      root: fanoutRoot,
      skill: 'architecture-audit-fanout',
      now: NOW,
    });
    expect(() =>
      main(
        [
          'draft-finding',
          '--loop',
          'architecture-audit-fanout',
          '--run',
          fanout.runId,
          '--id',
          'F-1',
          '--severity',
          'high',
        ],
        { root: fanoutRoot, out: () => {} },
      ),
    ).toThrow(/not owned/);
  });

  it('requires outcome-specific disposition proof', () => {
    const root = workspace({ 'architecture-refresh': FINDING_SET });
    const { runId } = openRun({ root, skill: 'architecture-refresh', now: NOW });
    expect(() =>
      recordDisposition({
        root,
        skill: 'architecture-refresh',
        runId,
        id: 'F-1',
        outcome: 'contained',
        target: 'INFRA-131',
      }),
    ).toThrow(/requires --target, --site and --evidence/);
    expect(() =>
      recordDisposition({
        root,
        skill: 'architecture-refresh',
        runId,
        id: 'F-2',
        outcome: 'invalid',
      }),
    ).toThrow(/requires --site and --evidence/);
  });
});

describe('closeRun', () => {
  it('seals the entry, and a later round or close on the same run is refused', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    recordRound({ root, skill: 'looper', runId, findings: 2 });
    const closed = closeRun({ root, skill: 'looper', runId, terminal: 'converged', now: NOW });
    expect(closed.terminal).toBe('converged');
    expect(() => recordRound({ root, skill: 'looper', runId, findings: 0 })).toThrow(
      /sealed record/,
    );
    expect(() =>
      closeRun({ root, skill: 'looper', runId, terminal: 'abandoned', now: NOW }),
    ).toThrow(/sealed record/);
  });

  it('permits `no-progress` only for a loop that declares that escape', () => {
    const root = workspace({ looper: FINDING_SET, tries: ATTEMPT });
    const a = openRun({ root, skill: 'looper', now: NOW });
    expect(
      closeRun({ root, skill: 'looper', runId: a.runId, terminal: 'no-progress', now: NOW })
        .terminal,
    ).toBe('no-progress');
    const b = openRun({ root, skill: 'tries', now: NOW });
    expect(() =>
      closeRun({ root, skill: 'tries', runId: b.runId, terminal: 'no-progress', now: NOW }),
    ).toThrow(/escape=no-progress/);
  });

  it('permits `bound-reached` only for a loop that declares a NUMERIC bound', () => {
    const root = workspace({ looper: FINDING_SET, tries: ATTEMPT });
    const a = openRun({ root, skill: 'tries', now: NOW });
    expect(
      closeRun({ root, skill: 'tries', runId: a.runId, terminal: 'bound-reached', now: NOW })
        .terminal,
    ).toBe('bound-reached');
    const b = openRun({ root, skill: 'looper', now: NOW });
    expect(() =>
      closeRun({ root, skill: 'looper', runId: b.runId, terminal: 'bound-reached', now: NOW }),
    ).toThrow(/NUMERIC bound/);
  });

  it('refuses a terminal reason outside the vocabulary, and names the vocabulary', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    expect(() => closeRun({ root, skill: 'looper', runId, terminal: 'done', now: NOW })).toThrow(
      /converged/,
    );
  });

  it('accepts `abandoned` for every loop kind — that is what makes a dropped run visible', () => {
    const root = workspace({ looper: FINDING_SET, tries: ATTEMPT });
    for (const skill of ['looper', 'tries']) {
      const { runId } = openRun({ root, skill, now: NOW });
      expect(closeRun({ root, skill, runId, terminal: 'abandoned', now: NOW }).terminal).toBe(
        'abandoned',
      );
    }
  });
});

describe('permitsTerminal', () => {
  it('holds every vocabulary member reachable for some declaration', () => {
    expect(terminalReasonNames()).toEqual([
      'converged',
      'no-progress',
      'bound-reached',
      'halted-for-user',
      'abandoned',
    ]);
    for (const name of terminalReasonNames()) {
      const permitted =
        permitsTerminal({ over: 'finding-set', escape: 'no-progress' }, name).ok ||
        permitsTerminal({ over: 'attempt', bound: '3 attempts' }, name).ok;
      expect(permitted).toBe(true);
    }
  });
});

describe('readLedger', () => {
  it('THROWS on a line that does not parse, naming the file and line — never skips it', () => {
    const root = workspace({ looper: FINDING_SET });
    openRun({ root, skill: 'looper', now: NOW });
    const file = path.join(root, LEDGER_DIR, 'looper.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8') + 'not json\n', 'utf8');
    expect(() => readLedger(root, 'looper')).toThrow(/looper\.jsonl:2/);
  });

  it('reports no entries for a skill with no ledger, which is not an error', () => {
    const root = workspace({ looper: FINDING_SET });
    expect(readLedger(root, 'looper')).toEqual([]);
    expect(ledgerSkills(root)).toEqual([]);
  });
});

describe('the CLI', () => {
  it('makes a signal expectation recordable before dispatch', () => {
    const root = workspace({ 'architecture-refresh': FINDING_SET });
    main(['open', '--loop', 'architecture-refresh'], { root, now: NOW, out: () => {} });
    const runId = readLedger(root, 'architecture-refresh')[0].runId;
    expect(
      main(
        [
          'expect',
          '--loop',
          'architecture-refresh',
          '--run',
          runId,
          '--phase',
          'conformance',
          '--agent',
          'architecture-conformance-auditor',
          '--subject',
          'scope',
          '--token',
          'ACTIONABLE FINDINGS',
        ],
        { root, now: NOW, out: () => {} },
      ),
    ).toBe(0);
    expect(
      readLedger(root, 'architecture-refresh')[0].extensions.architectureRefresh.signalExpectations,
    ).toHaveLength(1);
  });

  it('makes observations and routing metadata recordable without editing JSONL by hand', () => {
    const root = workspace({ 'architecture-refresh': FINDING_SET });
    main(['open', '--loop', 'architecture-refresh'], { root, now: NOW, out: () => {} });
    const runId = readLedger(root, 'architecture-refresh')[0].runId;
    const common = ['--loop', 'architecture-refresh', '--run', runId];
    main(
      [
        'expect',
        ...common,
        '--phase',
        'verify',
        '--agent',
        'finding-verifier',
        '--subject',
        'F-1',
        '--token',
        'VERIFY',
      ],
      { root, out: () => {} },
    );
    expect(
      main(
        [
          'observe',
          ...common,
          '--phase',
          'verify',
          '--agent',
          'finding-verifier',
          '--subject',
          'F-1',
          '--signal',
          'VERIFY: id=F-1 outcome=CONFIRMED severity-opinion=unchanged',
        ],
        { root, now: NOW, out: () => {} },
      ),
    ).toBe(0);
    expect(main(['pass-through', ...common, '--id', 'F-2'], { root, out: () => {} })).toBe(0);
    expect(main(['foundational', ...common, '--id', 'F-3'], { root, out: () => {} })).toBe(0);
    expect(
      main(
        [
          'reconcile-route',
          ...common,
          '--id',
          'F-3',
          '--action',
          'reused',
          '--target',
          'INFRA-131',
        ],
        { root, out: () => {} },
      ),
    ).toBe(0);
    expect(
      main(
        [
          'disposition',
          ...common,
          '--id',
          'F-3',
          '--outcome',
          'contained',
          '--target',
          'INFRA-131',
          '--site',
          '.agents/specs/claim.md',
          '--evidence',
          'F-3',
        ],
        { root, out: () => {} },
      ),
    ).toBe(0);
    expect(main(['link', ...common, '--nested-run', 'nested-r1'], { root, out: () => {} })).toBe(0);
    const entry = readLedger(root, 'architecture-refresh')[0];
    const metadata = entry.extensions.architectureRefresh;
    expect(metadata.signalObservations).toHaveLength(1);
    expect(metadata.verificationPassThroughIds).toEqual([{ round: 1, id: 'F-2' }]);
    expect(metadata.foundationalIds).toEqual([{ round: 1, id: 'F-3' }]);
    expect(metadata.reconciliationRoutes[0].action).toBe('reused');
    expect(metadata.dispositions[0].target).toBe('INFRA-131');
    expect(metadata.nestedRuns).toEqual([{ round: 1, runId: 'nested-r1' }]);
  });

  it('records expected coverage cells and draft/final finding identities with severity', () => {
    const root = workspace({
      'architecture-audit-fanout': FINDING_SET,
      'architecture-refresh': FINDING_SET,
    });
    main(['open', '--loop', 'architecture-audit-fanout'], { root, now: NOW, out: () => {} });
    const fanoutRunId = readLedger(root, 'architecture-audit-fanout')[0].runId;
    const fanoutCommon = ['--loop', 'architecture-audit-fanout', '--run', fanoutRunId];
    main(
      [
        'expect',
        ...fanoutCommon,
        '--phase',
        'audit',
        '--agent',
        'architecture-structure-auditor',
        '--subject',
        'structure:1/1',
        '--token',
        'AUDIT-DIM-COMPLETE',
        '--cells',
        'target-a:c1,target-a:c2',
      ],
      { root, out: () => {} },
    );
    main(['open', '--loop', 'architecture-refresh'], { root, now: NOW, out: () => {} });
    const runId = readLedger(root, 'architecture-refresh')[0].runId;
    const common = ['--loop', 'architecture-refresh', '--run', runId];
    main(['draft-finding', ...common, '--id', 'F-1', '--severity', 'high'], {
      root,
      out: () => {},
    });
    main(['final-finding', ...common, '--id', 'F-1', '--severity', 'medium'], {
      root,
      out: () => {},
    });

    const fanoutMetadata = readLedger(root, 'architecture-audit-fanout')[0].extensions
      .architectureRefresh;
    expect(fanoutMetadata.signalExpectations[0].cells).toEqual(['target-a:c1', 'target-a:c2']);
    const metadata = readLedger(root, 'architecture-refresh')[0].extensions.architectureRefresh;
    expect(metadata.draftFindings).toEqual([{ round: 1, id: 'F-1', severity: 'high' }]);
    expect(metadata.finalFindings).toEqual([{ round: 1, id: 'F-1', severity: 'medium' }]);
  });

  it('refuses observe-before-expect and duplicate observations', () => {
    const root = workspace({ 'architecture-refresh': FINDING_SET });
    main(['open', '--loop', 'architecture-refresh'], { root, now: NOW, out: () => {} });
    const runId = readLedger(root, 'architecture-refresh')[0].runId;
    const common = ['--loop', 'architecture-refresh', '--run', runId];
    const observe = [
      'observe',
      ...common,
      '--phase',
      'verify',
      '--agent',
      'finding-verifier',
      '--subject',
      'F-1',
      '--signal',
      'VERIFY: id=F-1 outcome=CONFIRMED severity-opinion=unchanged',
    ];
    expect(() => main(observe, { root, out: () => {} })).toThrow(/prior expectation/);
    main(
      [
        'expect',
        ...common,
        '--phase',
        'verify',
        '--agent',
        'finding-verifier',
        '--subject',
        'F-1',
        '--token',
        'VERIFY',
      ],
      { root, out: () => {} },
    );
    expect(main(observe, { root, out: () => {} })).toBe(0);
    expect(() => main(observe, { root, out: () => {} })).toThrow(/already exists/);
  });

  it('drives open → round → close and prints the round count from the array', () => {
    const root = workspace({ looper: FINDING_SET });
    const lines = [];
    const out = (text) => lines.push(text);
    expect(main(['open', '--loop', 'looper'], { root, now: NOW, out })).toBe(0);
    const runId = readLedger(root, 'looper')[0].runId;
    expect(
      main(['round', '--loop', 'looper', '--run', runId, '--findings', '2'], {
        root,
        now: NOW,
        out,
      }),
    ).toBe(0);
    expect(
      main(['close', '--loop', 'looper', '--run', runId, '--terminal', 'converged'], {
        root,
        now: NOW,
        out,
      }),
    ).toBe(0);
    expect(lines.at(-1)).toContain('CLOSED as `converged` after 1 round(s)');
    expect(existsSync(path.join(root, LEDGER_DIR, 'looper.jsonl'))).toBe(true);
  });

  it('refuses an unknown command rather than doing nothing quietly', () => {
    const root = workspace({ looper: FINDING_SET });
    expect(() =>
      main(['frobnicate', '--loop', 'looper'], { root, now: NOW, out: () => {} }),
    ).toThrow(/unknown command/);
  });

  it('records a revision/projection expectation before its exact recommendation observation', () => {
    const root = workspace({ 'backlog-execution-orchestrator': FINDING_SET });
    main(['open', '--loop', 'backlog-execution-orchestrator'], { root, now: NOW, out: () => {} });
    const runId = readLedger(root, 'backlog-execution-orchestrator')[0].runId;
    const common = [
      '--loop',
      'backlog-execution-orchestrator',
      '--run',
      runId,
      '--subject',
      'INFRA-999-proof.md',
      '--revision',
      'a'.repeat(40),
      '--projection-digest',
      'b'.repeat(64),
    ];
    expect(main(['recommendation-expect', ...common], { root, now: NOW, out: () => {} })).toBe(0);
    expect(
      main(
        ['recommendation-observe', ...common, '--verdict', 'ENDORSE', '--unresolved-findings', '0'],
        { root, now: NOW, out: () => {} },
      ),
    ).toBe(0);
    const metadata = readLedger(root, 'backlog-execution-orchestrator')[0].extensions
      .recommendationReview;
    expect(metadata.expectations).toHaveLength(1);
    expect(metadata.observations[0]).toMatchObject({ verdict: 'ENDORSE', unresolvedFindings: 0 });
  });
});
