import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  roundRobin,
} from '@robota-sdk/agent-roundtable';
import type {
  AgentParticipant,
  RoundtableEvent,
  RoundtableRegistry,
} from '@robota-sdk/agent-roundtable';
import { describe, expect, it } from 'vitest';

import { createFakeAgent } from './fake-agent';
import { participantFor } from './test-support';

/** A hand-written participant that checkpoints, so only the ACP participant blocks a reload. */
function scribe(): AgentParticipant {
  return {
    kind: 'agent',
    id: 'scribe',
    runtime: { id: 'fixture/scribe', version: '1' },
    factory: {
      modelCalls: 'none',
      checkpointVersions: ['1'],
      openSession: async () => {
        let count = 0;
        return {
          session: {
            runTurn: async () => ({ kind: 'speak', content: `note ${(count += 1)}` }),
            checkpoint: async () => ({ version: '1', data: count }),
          },
          release: async () => {},
        };
      },
    },
  };
}

function agentRepliesInOrder() {
  let replies = 0;
  return createFakeAgent({
    prompt: async (call) => {
      replies += 1;
      await call.chunk(`agent `);
      await call.chunk(`reply ${replies}`);
      return { stopReason: 'end_turn' };
    },
  });
}

describe('an ACP participant in a real roundtable', () => {
  it('takes its turns in the selected order, reads increments and reports no usage', async () => {
    const fake = agentRepliesInOrder();
    const acp = participantFor(fake);
    const published: string[] = [];
    const deltas: string[] = [];
    const onEvent = (event: RoundtableEvent) => {
      if (event.type === 'published')
        for (const item of event.messages) published.push(`${item.participantId}: ${item.content}`);
      if (event.type === 'delta' && event.participantId === 'acp') deltas.push(event.text);
    };
    const store = new MemoryConversationStore();
    // A model-call limit is accepted because both factories declare `none`, and it never binds them.
    const room = createRoundtable({
      conversationId: 'room',
      purpose: 'Review the plan',
      participants: [scribe(), acp],
      selector: roundRobin(),
      store,
      limits: { maxTurnsPerRun: 4, maxModelCallsPerRun: 1 },
      onEvent,
    });
    const result = await room.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'turns' });

    const expected = [
      'scribe: note 1',
      'acp: agent reply 1',
      'scribe: note 2',
      'acp: agent reply 2',
    ];
    expect(published).toEqual(expected);
    expect(room.snapshot().messages.map((m) => `${m.participantId}: ${m.content}`)).toEqual(
      expected,
    );
    expect(deltas).toEqual(['agent ', 'reply 1', 'agent ', 'reply 2']);

    // The agent was sent only what it had not seen: never its own reply, never a message twice.
    expect(fake.prompts().map((params) => (params.prompt as { text: string }[])[0].text)).toEqual([
      'Purpose: Review the plan\n\n### From scribe\n> note 1',
      '### From scribe\n> note 2',
    ]);

    expect(room.snapshot().usage).toEqual([]);
    await room.dispose();
    expect(fake.closes()).toBe(1);
  });

  it('cannot be loaded back once it has taken a turn', async () => {
    const fake = agentRepliesInOrder();
    const acp = participantFor(fake);
    const store = new MemoryConversationStore();
    const hand = scribe();
    const room = createRoundtable({
      conversationId: 'reload',
      participants: [hand, acp],
      store,
      limits: { maxTurnsPerRun: 2 },
    });
    await room.run();
    await room.dispose();

    const registry: RoundtableRegistry = {
      resolveParticipant: async (reference) => {
        const found = [hand, acp].find((candidate) => candidate.runtime.id === reference.id);
        if (!found) throw new Error(`unregistered runtime ${reference.id}`);
        return { reference: found.runtime, factory: found.factory };
      },
    };
    await expect(
      loadRoundtable({ conversationId: 'reload', store, registry }),
    ).rejects.toMatchObject({
      code: 'recovery-required',
      message: expect.stringContaining('acp'),
    });
  });
});
