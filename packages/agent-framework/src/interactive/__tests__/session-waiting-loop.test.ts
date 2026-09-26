/**
 * #3189 — Esc on an idle prompt stops the self-paced loop waiting for its wake. The rule is the
 * session's, so every client, attached or in-process, gets the same answer.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { createSessionStub } from './helpers/session-stub.js';

import type { ISessionLoopState } from '@robota-sdk/agent-interface-session';

function loop(loopId: string, phase: ISessionLoopState['phase']): ISessionLoopState {
  return { loopId, phase } as ISessionLoopState;
}

function sessionWith(loops: ISessionLoopState[]): {
  session: InteractiveSession;
  stop: ReturnType<typeof vi.fn>;
} {
  const session = new InteractiveSession({ session: createSessionStub(), cwd: '/tmp' });
  vi.spyOn(session, 'listSelfPacedLoops').mockReturnValue(loops);
  const stop = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(session, 'stopSelfPacedLoop').mockImplementation(stop);
  return { session, stop };
}

describe('InteractiveSession.stopWaitingSelfPacedLoop (#3189)', () => {
  it('does nothing when no loop is waiting', async () => {
    const { session, stop } = sessionWith([loop('loop_a', 'running'), loop('loop_b', 'stopped')]);

    await expect(session.stopWaitingSelfPacedLoop()).resolves.toEqual({ kind: 'none' });
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops the one waiting loop with the given reason', async () => {
    const { session, stop } = sessionWith([loop('loop_a', 'waiting'), loop('loop_b', 'running')]);

    const outcome = await session.stopWaitingSelfPacedLoop('Loop stopped by Esc');

    expect(outcome).toEqual({ kind: 'stopped', loopId: 'loop_a', message: 'Loop loop_a stopped.' });
    expect(stop).toHaveBeenCalledWith('loop_a', 'Loop stopped by Esc');
  });

  it('stops none when several wait, and names /loop stop', async () => {
    const { session, stop } = sessionWith([loop('loop_a', 'waiting'), loop('loop_b', 'waiting')]);

    const outcome = await session.stopWaitingSelfPacedLoop();

    expect(outcome.kind).toBe('several');
    expect(outcome.kind === 'several' && outcome.message).toContain('/loop stop');
    expect(stop).not.toHaveBeenCalled();
  });

  it('reports a stop that failed', async () => {
    const { session, stop } = sessionWith([loop('loop_a', 'waiting')]);
    stop.mockRejectedValueOnce(new Error('store unavailable'));

    const outcome = await session.stopWaitingSelfPacedLoop();

    expect(outcome).toEqual({
      kind: 'failed',
      loopId: 'loop_a',
      message: 'Could not stop loop loop_a: store unavailable',
    });
  });
});
