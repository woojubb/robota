// harness-coverage: work-run-event-hash.mjs
// harness-coverage: work-run-state-transition.mjs
import { describe, expect, it } from 'vitest';

import {
  WORK_RUN_EVENT_TYPES,
  appendWorkRunEvent,
  cohortKey,
  createInitialWorkRun,
  decodeWorkRunReceipt,
  projectWorkRunDurations,
  reduceWorkRun,
} from '../work-run-contract.mjs';

const at = (second) => `2026-08-30T00:00:${String(second).padStart(2, '0')}.000Z`;

function legalRun() {
  let run = createInitialWorkRun({ runId: 'run-1', at: at(0) });
  for (const [type, second, data] of [
    ['work.bound', 1, { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' }],
    ['work.started', 2, {}],
    ['phase.started', 3, { phase: 'implementation' }],
    ['work.paused', 5, { reason: 'waiting' }],
    ['work.resumed', 8, {}],
    ['phase.completed', 10, { phase: 'implementation' }],
    ['work.ready', 12, { revision: 0, generation: 0 }],
  ]) {
    run = appendWorkRunEvent(run, { type, at: at(second), data });
  }
  return run;
}

const generationApproval = Object.freeze({
  ground: 'red-check',
  prNumber: 2514,
  evidence: 'https://github.com/woojubb/robota/actions/runs/1',
});

describe('work-run contract', () => {
  it('keeps a closed v1 event union and a hash-chained sequence', () => {
    expect(WORK_RUN_EVENT_TYPES).toEqual([
      'work.claimed',
      'work.bound',
      'work.started',
      'phase.started',
      'phase.completed',
      'work.paused',
      'work.resumed',
      'work.ready',
      'work.reopened',
      'work.abandoned',
      'work.excluded',
    ]);
    const run = legalRun();
    expect(run.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(run.events[1].previousHash).toBe(run.events[0].hash);
    expect(() => appendWorkRunEvent(run, { type: 'work.guessed', at: at(13), data: {} })).toThrow(
      /unknown event/i,
    );
  });

  it('rejects invalid phase and pause transitions', () => {
    const claimed = createInitialWorkRun({ runId: 'run-2', at: at(0) });
    expect(() =>
      appendWorkRunEvent(claimed, {
        type: 'phase.started',
        at: at(1),
        data: { phase: 'implementation' },
      }),
    ).toThrow(/started/i);
    expect(() =>
      appendWorkRunEvent(claimed, { type: 'work.resumed', at: at(1), data: {} }),
    ).toThrow(/pause/i);
  });

  it('enforces exact nonnegative generation and revision progression', () => {
    const ready = legalRun();
    expect(() =>
      appendWorkRunEvent(ready, {
        type: 'work.reopened',
        at: at(13),
        data: { generation: 0, revision: 2, ground: 'finding' },
      }),
    ).toThrow(/revision/i);
    expect(() =>
      appendWorkRunEvent(ready, {
        type: 'work.reopened',
        at: at(13),
        data: { generation: 1, revision: 1, ground: 'finding' },
      }),
    ).toThrow(/revision/i);
    expect(() =>
      appendWorkRunEvent(ready, {
        type: 'work.reopened',
        at: at(13),
        data: { generation: 2, revision: 0, ground: 'finding' },
      }),
    ).toThrow(/generation/i);

    let revision = appendWorkRunEvent(ready, {
      type: 'work.reopened',
      at: at(13),
      data: { generation: 0, revision: 1, ground: 'finding' },
    });
    expect(() =>
      appendWorkRunEvent(revision, {
        type: 'work.ready',
        at: at(14),
        data: { generation: 0, revision: 0 },
      }),
    ).toThrow(/match/i);
    revision = appendWorkRunEvent(revision, {
      type: 'work.ready',
      at: at(14),
      data: { generation: 0, revision: 1 },
    });
    expect(reduceWorkRun(revision.events)).toMatchObject({ generation: 0, revision: 1 });

    let generation = appendWorkRunEvent(revision, {
      type: 'work.reopened',
      at: at(15),
      data: {
        generation: 1,
        revision: 0,
        ground: 'red-check',
        authorization: generationApproval,
      },
    });
    generation = appendWorkRunEvent(generation, {
      type: 'work.ready',
      at: at(16),
      data: { generation: 1, revision: 0 },
    });
    expect(reduceWorkRun(generation.events)).toMatchObject({ generation: 1, revision: 0 });

    const started = legalRun().events.slice(0, -1);
    expect(() =>
      appendWorkRunEvent(
        { schemaVersion: 1, runId: 'run-1', events: started },
        {
          type: 'work.ready',
          at: at(12),
          data: { generation: -1, revision: 0 },
        },
      ),
    ).toThrow(/nonnegative/i);
  });

  it('reconstructs wall, active, paused and phase durations without averages', () => {
    const run = legalRun();
    expect(projectWorkRunDurations(run.events)).toEqual({
      wallMs: 12_000,
      activeMs: 9_000,
      pausedMs: 3_000,
      phases: { implementation: 7_000 },
    });
    expect(cohortKey(reduceWorkRun(run.events))).toBe('L2/observability');
  });

  it('projects generation rework from its revision-zero reopen', () => {
    let run = legalRun();
    for (const [type, second, data] of [
      [
        'work.reopened',
        13,
        {
          generation: 1,
          revision: 0,
          ground: 'red-check',
          authorization: generationApproval,
        },
      ],
      ['phase.started', 14, { phase: 'rework' }],
      ['phase.completed', 16, { phase: 'rework' }],
      ['work.ready', 18, { generation: 1, revision: 0 }],
      [
        'work.reopened',
        19,
        {
          generation: 1,
          revision: 1,
          ground: 'red-check',
          authorization: generationApproval,
        },
      ],
      ['work.ready', 20, { generation: 1, revision: 1 }],
    ]) {
      run = appendWorkRunEvent(run, { type, at: at(second), data });
    }

    expect(projectWorkRunDurations(run.events)).toEqual({
      wallMs: 7_000,
      activeMs: 7_000,
      pausedMs: 0,
      phases: { rework: 2_000 },
    });
  });

  it('rejects malformed authorization-bearing reopen events', () => {
    const ready = legalRun();
    for (const authorization of [null, [], 'approved']) {
      expect(() =>
        appendWorkRunEvent(ready, {
          type: 'work.reopened',
          at: at(13),
          data: {
            generation: 1,
            revision: 0,
            ground: 'red-check',
            authorization,
          },
        }),
      ).toThrow(/authorization/i);
    }
    expect(() =>
      appendWorkRunEvent(ready, {
        type: 'work.reopened',
        at: at(13),
        data: {
          generation: 1,
          revision: 0,
          ground: 'red-check',
          authorization: { ground: 'finding' },
        },
      }),
    ).toThrow(/ground/i);
    expect(() =>
      appendWorkRunEvent(ready, {
        type: 'work.reopened',
        at: at(13),
        data: {
          generation: 0,
          revision: 1,
          ground: 'finding',
          authorization: { ground: 'finding' },
        },
      }),
    ).toThrow(/generation 0/i);
  });

  it('reuses the revision-zero authorization across post-PR revisions only', () => {
    expect(() =>
      appendWorkRunEvent(legalRun(), {
        type: 'work.reopened',
        at: at(13),
        data: { generation: 1, revision: 0, ground: 'red-check' },
      }),
    ).toThrow(/revision-zero authorization/i);

    let run = appendWorkRunEvent(legalRun(), {
      type: 'work.reopened',
      at: at(13),
      data: {
        generation: 1,
        revision: 0,
        ground: 'red-check',
        authorization: generationApproval,
      },
    });
    run = appendWorkRunEvent(run, {
      type: 'work.ready',
      at: at(14),
      data: { generation: 1, revision: 0 },
    });
    const generationReady = run;
    expect(() =>
      appendWorkRunEvent(generationReady, {
        type: 'work.reopened',
        at: at(15),
        data: { generation: 1, revision: 1, ground: 'red-check' },
      }),
    ).toThrow(/reuse/i);
    expect(() =>
      appendWorkRunEvent(generationReady, {
        type: 'work.reopened',
        at: at(15),
        data: {
          generation: 1,
          revision: 1,
          ground: 'red-check',
          authorization: { ...generationApproval, evidence: 'https://example.com/changed' },
        },
      }),
    ).toThrow(/exactly/i);
    expect(() =>
      appendWorkRunEvent(generationReady, {
        type: 'work.reopened',
        at: at(15),
        data: {
          generation: 1,
          revision: 1,
          ground: 'finding',
          authorization: { ...generationApproval, ground: 'finding' },
        },
      }),
    ).toThrow(/ground exactly/i);
    run = appendWorkRunEvent(run, {
      type: 'work.reopened',
      at: at(15),
      data: {
        generation: 1,
        revision: 1,
        ground: 'red-check',
        authorization: { ...generationApproval },
      },
    });

    expect(reduceWorkRun(run.events)).toMatchObject({ generation: 1, revision: 1 });
  });

  it('fails closed on unknown receipt versions and event corruption', () => {
    const run = legalRun();
    const receipt = {
      schemaVersion: 1,
      disposition: 'included',
      runId: run.runId,
      events: run.events,
      identity: { repository: 'woojubb/robota', branch: 'topic' },
    };
    expect(decodeWorkRunReceipt(receipt).runId).toBe('run-1');
    expect(() => decodeWorkRunReceipt({ ...receipt, schemaVersion: 2 })).toThrow(/schema/i);
    const corrupt = structuredClone(receipt);
    corrupt.events[1].previousHash = 'wrong';
    expect(() => decodeWorkRunReceipt(corrupt)).toThrow(/hash/i);
  });
});
