/**
 * Room — shared-transcript multi-agent primitive (ROOM-001).
 *
 * Covers: transcript fan-in ordering + attribution, turn-selector invocation order,
 * join/leave rules, the deterministic 3-agent / 6-turn scripted exchange (functional row
 * of the backlog test plan), and the unknown-speaker no-fallback throw.
 */

import { describe, expect, it } from 'vitest';

import { AbstractAIProvider, Robota } from '@robota-sdk/agent-core';
import { Room } from '../room/room.js';
import { createCallbackSelector, createRoundRobinSelector } from '../room/turn-selector.js';

import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';

/** Provider that answers with a fixed prefix + the count of transcript lines it was shown. */
class ScriptedSpeakerProvider extends AbstractAIProvider {
  readonly name = 'scripted-speaker';
  readonly version = '1.0.0';
  constructor(private readonly speakerTag: string) {
    super();
  }
  async chat(messages: TUniversalMessage[], _options?: IChatOptions): Promise<TUniversalMessage> {
    const input = String(messages[messages.length - 1]?.content ?? '');
    const seenTurns = input
      .split('\n')
      .filter((line) => /^(alice|bob|carol|human): /.test(line)).length;
    return {
      id: `m-${Math.random().toString(36).slice(2)}`,
      role: 'assistant',
      content: `${this.speakerTag} speaks (saw ${seenTurns} turns)`,
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
  override async *chatStream(): AsyncIterable<TUniversalMessage> {
    yield await this.chat([]);
  }
}

function makeAgent(tag: string): Robota {
  return new Robota({
    name: `agent-${tag}`,
    aiProviders: [new ScriptedSpeakerProvider(tag)],
    defaultModel: { provider: 'scripted-speaker', model: 'scripted' },
    retainHistory: false,
    logging: { level: 'silent', enabled: false },
  });
}

describe('Room (ROOM-001)', () => {
  it('completes a deterministic 3-agent, 6-turn round-robin exchange on one shared transcript', async () => {
    const room = new Room({ topic: 'test exchange' });
    room.join({ name: 'alice', agent: makeAgent('alice') });
    room.join({ name: 'bob', agent: makeAgent('bob') });
    room.join({ name: 'carol', agent: makeAgent('carol') });

    const transcript = await room.run({ selector: createRoundRobinSelector(2) });

    expect(transcript).toHaveLength(6);
    expect(transcript.map((t) => t.speaker)).toEqual([
      'alice',
      'bob',
      'carol',
      'alice',
      'bob',
      'carol',
    ]);
    // Fan-in ordering: each speaker saw exactly the turns committed before its own.
    transcript.forEach((entry, index) => {
      expect(entry.content).toBe(`${entry.speaker} speaks (saw ${index} turns)`);
    });
    // Attribution rides the append-only store messages.
    const stored = room.getTranscriptMessages();
    expect(stored).toHaveLength(6);
    expect(stored.map((m) => m.metadata?.speaker)).toEqual([
      'alice',
      'bob',
      'carol',
      'alice',
      'bob',
      'carol',
    ]);
  });

  it('invokes the selector with a growing view and stops on null', async () => {
    const room = new Room();
    room.join({ name: 'alice', agent: makeAgent('alice') });
    const seenCounts: number[] = [];

    await room.run({
      selector: createCallbackSelector((view) => {
        seenCounts.push(view.turnCount);
        return view.turnCount >= 2 ? null : 'alice';
      }),
    });

    expect(seenCounts).toEqual([0, 1, 2]);
    expect(room.getTranscript()).toHaveLength(2);
  });

  it('enforces the maxTurns safety cap over a never-ending selector', async () => {
    const room = new Room();
    room.join({ name: 'alice', agent: makeAgent('alice') });

    const transcript = await room.run({
      selector: createCallbackSelector(() => 'alice'),
      maxTurns: 3,
    });

    expect(transcript).toHaveLength(3);
  });

  it('throws (no fallback) when the selector picks an unknown speaker', async () => {
    const room = new Room();
    room.join({ name: 'alice', agent: makeAgent('alice') });

    await expect(room.run({ selector: createCallbackSelector(() => 'mallory') })).rejects.toThrow(
      'unknown speaker "mallory"',
    );
  });

  it('join rejects duplicate names; leave rejects absent names; leaving keeps past turns', async () => {
    const room = new Room();
    room.join({ name: 'alice', agent: makeAgent('alice') });
    expect(() => room.join({ name: 'alice', agent: makeAgent('alice') })).toThrow('already joined');

    await room.run({ selector: createRoundRobinSelector(1) });
    room.leave('alice');
    expect(() => room.leave('alice')).toThrow('not in the room');
    expect(room.getTranscript()).toHaveLength(1);
    expect(room.getMembers()).toEqual([]);
  });

  it('say() appends an externally-produced turn with attribution', async () => {
    const room = new Room();
    room.join({ name: 'alice', agent: makeAgent('alice') });
    room.say('human', 'Hello everyone');

    const transcript = await room.run({ selector: createRoundRobinSelector(1) });

    expect(transcript.map((t) => t.speaker)).toEqual(['human', 'alice']);
    // Alice saw the human turn.
    expect(transcript[1].content).toBe('alice speaks (saw 1 turns)');
  });

  it('rejects concurrent run() on the same room', async () => {
    const room = new Room();
    room.join({ name: 'alice', agent: makeAgent('alice') });

    const first = room.run({ selector: createRoundRobinSelector(1) });
    await expect(room.run({ selector: createRoundRobinSelector(1) })).rejects.toThrow(
      'already in progress',
    );
    await first;
  });
});
