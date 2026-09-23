import { describe, expect, it } from 'vitest';

import {
  claimSelfPacedLoopWake,
  createSelfPacedLoopState,
  finishSelfPacedLoopTurn,
  markSelfPacedLoopRunning,
  recoverSelfPacedLoopState,
} from '../session-loop-transitions.js';

const CREATED = Date.parse('2026-09-24T00:00:00.000Z');

describe('self-paced loop state transitions', () => {
  it('begins as a single pending iteration and commits a chosen delay after completion', () => {
    const initial = createSelfPacedLoopState('loop_1', 'Check CI', CREATED);
    expect(initial).toMatchObject({ phase: 'pending', generation: 0, fallbackUsed: false });
    const running = markSelfPacedLoopRunning(initial, 0, CREATED);
    expect(running?.phase).toBe('running');

    const next = finishSelfPacedLoopTurn(
      running!,
      0,
      { action: 'continue', delaySeconds: 90, reason: 'CI still running' },
      CREATED + 5_000,
    );
    expect(next).toMatchObject({
      phase: 'waiting',
      generation: 1,
      nextAllowedAt: '2026-09-24T00:01:35.000Z',
      delaySeconds: 90,
      reason: 'CI still running',
      fallbackUsed: false,
    });
    expect(claimSelfPacedLoopWake(next!, 1, CREATED + 94_999)).toBeNull();
    expect(claimSelfPacedLoopWake(next!, 1, CREATED + 95_000)?.phase).toBe('pending');
    expect(claimSelfPacedLoopWake(next!, 0, CREATED + 95_000)).toBeNull();
  });

  it('allows one 20-minute fallback and stops after a second omission', () => {
    const initial = createSelfPacedLoopState('loop_1', 'Check CI', CREATED);
    const first = markSelfPacedLoopRunning(initial, 0, CREATED)!;
    const fallback = finishSelfPacedLoopTurn(first, 0, null, CREATED + 1_000)!;
    expect(fallback).toMatchObject({
      phase: 'waiting',
      nextAllowedAt: '2026-09-24T00:20:01.000Z',
      delaySeconds: 1200,
      fallbackUsed: true,
    });
    const pending = claimSelfPacedLoopWake(fallback, 1, CREATED + 1_201_000)!;
    const second = markSelfPacedLoopRunning(pending, 1, CREATED + 1_201_000)!;
    expect(finishSelfPacedLoopTurn(second, 1, null, CREATED + 1_202_000)).toMatchObject({
      phase: 'stopped',
      terminalReason: 'missing-reschedule-decision',
    });
  });

  it('does not let a stale result reschedule a stopped or expired generation', () => {
    const initial = createSelfPacedLoopState('loop_1', 'Check CI', CREATED);
    const running = markSelfPacedLoopRunning(initial, 0, CREATED)!;
    const expired = finishSelfPacedLoopTurn(
      running,
      0,
      { action: 'continue', delaySeconds: 60, reason: 'Need another check' },
      CREATED + 7 * 24 * 60 * 60_000,
    );
    expect(expired?.phase).toBe('expired');
    expect(finishSelfPacedLoopTurn(expired!, 0, null, CREATED + 7 * 24 * 60 * 60_000)).toBeNull();
  });

  it('restores a future wait unchanged and skips an overdue wake instead of replaying it', () => {
    const initial = createSelfPacedLoopState('loop_1', 'Check CI', CREATED);
    const running = markSelfPacedLoopRunning(initial, 0, CREATED)!;
    const waiting = finishSelfPacedLoopTurn(
      running,
      0,
      { action: 'continue', delaySeconds: 60, reason: 'Check again' },
      CREATED,
    )!;
    expect(recoverSelfPacedLoopState(waiting, CREATED + 30_000)).toEqual(waiting);
    const recovered = recoverSelfPacedLoopState(waiting, CREATED + 120_000);
    expect(recovered).toMatchObject({
      phase: 'waiting',
      generation: 2,
      nextAllowedAt: '2026-09-24T00:03:00.000Z',
    });
  });

  it('does not replay a possibly executed turn after restart', () => {
    const pending = createSelfPacedLoopState('loop_1', 'Check CI', CREATED);
    const neverStarted = recoverSelfPacedLoopState(pending, CREATED + 60_000);
    expect(neverStarted).toMatchObject({
      phase: 'waiting',
      generation: 1,
      fallbackUsed: false,
      nextAllowedAt: '2026-09-24T00:02:00.000Z',
    });
    const running = markSelfPacedLoopRunning(pending, 0, CREATED)!;
    const uncertain = recoverSelfPacedLoopState(running, CREATED + 60_000);
    expect(uncertain).toMatchObject({
      phase: 'waiting',
      generation: 1,
      fallbackUsed: true,
      nextAllowedAt: '2026-09-24T00:21:00.000Z',
    });
    const again = recoverSelfPacedLoopState({ ...running, fallbackUsed: true }, CREATED + 60_000);
    expect(again).toMatchObject({ phase: 'stopped', terminalReason: 'interrupted-iteration' });
  });
});
