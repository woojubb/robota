import { describe, expect, it } from 'vitest';
import {
  createIn,
  finishingSelector,
  loadIn,
  runUntilKilled,
  World,
  type Scenario,
} from './durable-harness';

const sequential: Scenario = {
  conversationId: 'room',
  agents: ['alice', 'bob'],
  selector: finishingSelector(2, (turns) => ({
    kind: 'speak',
    participantId: turns % 2 === 0 ? 'alice' : 'bob',
  })),
};

// Alice's first turn journals: intent, request, response, intent, effect start.
const EFFECT_START_APPEND = 4;

describe('recovering after the host answered a reconciliation', () => {
  it('continues with the committed answer instead of parking the same request again', async () => {
    const world = new World();
    const first = world.generation({ at: 'append', k: EFFECT_START_APPEND, written: true });
    await runUntilKilled(first, createIn(sequential, first));

    // The restart parks the effect that started without a result, and the host answers it.
    const second = world.generation({ at: 'append', k: 0, written: false });
    const room = await loadIn(sequential, second);
    const parked = await runUntilKilled(second, room);
    if (parked.killed || parked.result.status !== 'waiting') throw new Error('Expected a wait');
    const [request] = parked.result.requests;
    if (request?.kind !== 'reconciliation') throw new Error('Expected a reconciliation request');
    const { effectId } = request.data as { effectId: string };
    await room.resume({
      requestId: request.id,
      responseId: 'host',
      expectedRevision: room.snapshot().revision,
      response: { kind: 'reconciliation', data: { result: 'paid by the host' } },
    });
    // The process dies before the participant journals the result.
    expect(await runUntilKilled(second, room)).toEqual({ killed: true });

    const third = world.generation();
    const again = await loadIn(sequential, third);
    const done = await runUntilKilled(third, again);
    if (done.killed) throw new Error('The final generation was killed');
    expect(done.result).toMatchObject({ status: 'completed', reason: 'done' });
    expect(again.snapshot().messages[0]!.content).toContain('paid by the host');
    // The effect itself never ran: the host's answer is its result.
    expect(world.effects.get(effectId) ?? 0).toBe(0);
    await again.dispose();
  });
});
