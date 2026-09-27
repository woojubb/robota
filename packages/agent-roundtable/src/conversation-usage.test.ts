import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  roundRobin,
  summarizeUsage,
  type AgentParticipant,
  type ParticipantExecutionOptions,
  type ParticipantFactory,
  type ParticipantOutcome,
  type ParticipantTurn,
  type PricePolicy,
  type TurnServices,
} from './index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function agent(
  id: string,
  run: (turn: ParticipantTurn, options: ParticipantExecutionOptions) => Promise<ParticipantOutcome>,
): AgentParticipant {
  return {
    kind: 'agent',
    id,
    runtime: { id: 'test', version: '1' },
    factory: {
      modelCalls: 'metered',
      openSession: async () => ({
        session: { runTurn: (turn, options) => run(turn, options) },
        release: async () => {},
      }),
    },
  };
}

describe('per-turn usage services and the admission ledger', () => {
  it('roundRobin declares that it makes no model calls', () => {
    expect(roundRobin().modelCalls).toBe('none');
  });

  it('binds distinct TurnServices to the selected participant and to the selector', async () => {
    let participantServices: TurnServices | undefined;
    let selectorServices: TurnServices | undefined;
    const room = createRoundtable({
      conversationId: 'bind',
      participants: [
        agent('a', async (_turn, options) => {
          participantServices = options.services;
          return { kind: 'speak', content: 'hi' };
        }),
      ],
      selector: {
        modelCalls: 'none',
        select: (_ctx, options) => {
          selectorServices = options.services;
          return { kind: 'speak', participantId: 'a' };
        },
      },
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    expect(participantServices).toBeDefined();
    expect(selectorServices).toBeDefined();
    expect(participantServices).not.toBe(selectorServices);
    await room.dispose();
  });

  it('serializes concurrent admissions so a per-run limit is never exceeded', async () => {
    const barrier = deferred<void>();
    let started = 0;
    const outcomes: Record<string, PromiseSettledResult<void>[]> = { a: [], b: [] };
    const make = (id: 'a' | 'b') =>
      agent(id, async (_turn, options) => {
        if (++started === 2) barrier.resolve();
        await barrier.promise;
        outcomes[id] = await Promise.allSettled([
          options.services.admitModelCall({ callId: `${id}-1`, providerId: 'p', modelId: 'm' }),
          options.services.admitModelCall({ callId: `${id}-2`, providerId: 'p', modelId: 'm' }),
        ]);
        return { kind: 'speak', content: id };
      });
    const room = createRoundtable({
      conversationId: 'limit-run',
      participants: [make('a'), make('b')],
      maxConcurrentParticipants: 2,
      limits: { maxTurnsPerRun: 2, maxModelCallsPerRun: 3 },
      selector: {
        modelCalls: 'none',
        select: () => ({ kind: 'parallel', participantIds: ['a', 'b'] }),
      },
    });
    const result = await room.run();
    expect(result.status).toBe('limited');
    const all = [...outcomes.a, ...outcomes.b];
    expect(all.filter((entry) => entry.status === 'fulfilled')).toHaveLength(3);
    const rejected = all.filter(
      (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'model-call-limit' });
    expect(room.snapshot().usage).toHaveLength(3);
    await room.dispose();
  });

  it('a rejected admission mid-turn ends the run terminal with model-calls, publishing nothing', async () => {
    const room = createRoundtable({
      conversationId: 'limit-terminal',
      participants: [
        agent('a', async (_turn, options) => {
          await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
          await options.services.admitModelCall({ callId: 'c2', providerId: 'p', modelId: 'm' });
          return { kind: 'speak', content: 'unreachable' };
        }),
      ],
      limits: { maxTurnsPerRun: 5, maxModelCallsPerRun: 1 },
    });
    const result = await room.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'model-calls' });
    expect(room.snapshot().messages).toEqual([]);
    const again = await room.run();
    expect(again).toMatchObject({ status: 'limited', reason: 'model-calls' });
    await room.dispose();
  });

  it('refuses to start a group when the remaining run allowance is below its member count', async () => {
    const calls = vi.fn();
    const room = createRoundtable({
      conversationId: 'limit-group-start',
      participants: [
        agent('a', async () => {
          calls();
          return { kind: 'speak', content: 'a' };
        }),
        agent('b', async () => {
          calls();
          return { kind: 'speak', content: 'b' };
        }),
      ],
      maxConcurrentParticipants: 2,
      limits: { maxTurnsPerRun: 5, maxModelCallsPerRun: 1 },
      selector: {
        modelCalls: 'none',
        select: () => ({ kind: 'parallel', participantIds: ['a', 'b'] }),
      },
    });
    const result = await room.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'model-calls' });
    expect(calls).not.toHaveBeenCalled();
    expect(room.snapshot().messages).toEqual([]);
    const second = await room.run();
    expect(second).toMatchObject({ status: 'limited', reason: 'model-calls' });
    expect(calls).not.toHaveBeenCalled();
    await room.dispose();
  });

  it('absorbs an identical settled report replay; a final report cannot be replaced', async () => {
    const room = createRoundtable({
      conversationId: 'dup-report',
      participants: [
        agent('a', async (_turn, options) => {
          await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
          await options.services.recordUsage({
            callId: 'c1',
            outcome: 'completed',
            provenance: 'reported',
            tokens: { input: 1, output: 2 },
            final: true,
          });
          await options.services.recordUsage({
            callId: 'c1',
            outcome: 'completed',
            provenance: 'reported',
            tokens: { input: 1, output: 2 },
            final: true,
          });
          await expect(
            options.services.recordUsage({
              callId: 'c1',
              outcome: 'failed',
              provenance: 'unknown',
              final: true,
            }),
          ).rejects.toMatchObject({ code: 'conflict' });
          return { kind: 'speak', content: 'ok' };
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    expect(room.snapshot().usage.filter((record) => record.callId === 'c1')).toHaveLength(1);
    await room.dispose();
  });

  it('an unknown-provenance report settles the reservation without defaulting tokens to zero', async () => {
    const room = createRoundtable({
      conversationId: 'unknown-usage',
      participants: [
        agent('a', async (_turn, options) => {
          await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
          await options.services.recordUsage({
            callId: 'c1',
            outcome: 'failed',
            provenance: 'unknown',
            final: true,
          });
          return { kind: 'speak', content: 'ok' };
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    const [record] = room.snapshot().usage;
    expect(record).toMatchObject({ status: 'settled', outcome: 'failed', provenance: 'unknown' });
    expect(record).not.toHaveProperty('tokens');
    expect(summarizeUsage(room.snapshot().usage).unknownCalls).toBe(1);
    await room.dispose();
  });

  it('attributes ledger records to the selector or the participant, with matching turn and attempt ids', async () => {
    let capturedTurn: ParticipantTurn | undefined;
    const room = createRoundtable({
      conversationId: 'attribution',
      participants: [
        agent('a', async (turn, options) => {
          capturedTurn = turn;
          await options.services.admitModelCall({
            callId: 'participant-call',
            providerId: 'p',
            modelId: 'm',
          });
          return { kind: 'speak', content: 'ok' };
        }),
      ],
      selector: {
        modelCalls: 'metered',
        select: async (_ctx, options) => {
          await options.services.admitModelCall({
            callId: 'selector-call',
            providerId: 'p',
            modelId: 'm',
          });
          return { kind: 'speak', participantId: 'a' };
        },
      },
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    const usage = room.snapshot().usage;
    const selectorRecord = usage.find((record) => record.callId === 'selector-call');
    const participantRecord = usage.find((record) => record.callId === 'participant-call');
    expect(selectorRecord?.principal.kind).toBe('selector');
    expect(selectorRecord?.turnId).toBeNull();
    expect(selectorRecord?.groupId).toBeNull();
    expect(participantRecord?.principal).toEqual({ kind: 'participant', id: 'a' });
    expect(participantRecord?.turnId).toBe(capturedTurn?.turnId);
    expect(participantRecord?.groupId).toBe(capturedTurn?.groupId);
    expect(participantRecord?.attemptId).toBe(capturedTurn?.attemptId);
    await room.dispose();
  });

  it('conversation- and participant-scoped call counts survive loadRoundtable', async () => {
    const store = new MemoryConversationStore();
    const factory: ParticipantFactory = {
      modelCalls: 'metered',
      checkpointVersions: ['1'],
      openSession: async () => ({
        session: {
          runTurn: async (_turn, options) => {
            await options.services.admitModelCall({
              callId: crypto.randomUUID(),
              providerId: 'p',
              modelId: 'm',
            });
            return { kind: 'speak', content: 'ok' };
          },
          checkpoint: async () => ({ version: '1', data: null }),
        },
        release: async () => {},
      }),
    };
    const participant: AgentParticipant = {
      kind: 'agent',
      id: 'a',
      runtime: { id: 'echo', version: '1' },
      factory,
    };
    const registry = {
      resolveParticipant: async () => ({ reference: { id: 'echo', version: '1' }, factory }),
    };

    const room = createRoundtable({
      conversationId: 'survive-load',
      participants: [participant],
      store,
      limits: {
        maxTurnsPerRun: 1,
        maxModelCallsPerConversation: 2,
        maxModelCallsPerParticipant: 2,
      },
    });
    await room.run();
    await room.dispose();

    const loaded1 = await loadRoundtable({ conversationId: 'survive-load', store, registry });
    expect(loaded1.snapshot().usage).toHaveLength(1);
    await loaded1.run();
    await loaded1.dispose();

    const loaded2 = await loadRoundtable({ conversationId: 'survive-load', store, registry });
    expect(loaded2.snapshot().usage).toHaveLength(2);
    const result = await loaded2.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'model-calls' });
    expect(loaded2.snapshot().usage).toHaveLength(2);
    await loaded2.dispose();

    const loaded3 = await loadRoundtable({ conversationId: 'survive-load', store, registry });
    expect(loaded3.snapshot().usage).toHaveLength(2);
    expect(await loaded3.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
    await loaded3.dispose();
  });

  it('rejects configuring model-call limits or pricing without every factory and the selector declaring modelCalls', () => {
    const bareFactory: ParticipantFactory = {
      openSession: async () => ({
        session: { runTurn: async () => ({ kind: 'speak', content: 'x' }) },
        release: async () => {},
      }),
    };
    expect(() =>
      createRoundtable({
        conversationId: 'invalid-cap-factory',
        participants: [
          { kind: 'agent', id: 'a', runtime: { id: 't', version: '1' }, factory: bareFactory },
        ],
        limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 1 },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));

    expect(() =>
      createRoundtable({
        conversationId: 'invalid-cap-selector',
        participants: [agent('a', async () => ({ kind: 'speak', content: 'x' }))],
        selector: { select: () => ({ kind: 'finish', reason: 'done' }) },
        limits: { maxTurnsPerRun: 1 },
        pricing: { version: 'v1', cost: () => null },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });

  it('stamps settled usage with the configured pricing version and refuses a reload under another one', async () => {
    const store = new MemoryConversationStore();
    const pricing: PricePolicy = {
      version: 'v1',
      cost: (record) => (record.status === 'settled' ? { currency: 'USD', minorUnits: '5' } : null),
    };
    const factory: ParticipantFactory = {
      modelCalls: 'metered',
      checkpointVersions: ['1'],
      openSession: async () => ({
        session: {
          runTurn: async (_turn, options) => {
            await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
            await options.services.recordUsage({
              callId: 'c1',
              outcome: 'completed',
              provenance: 'reported',
              final: true,
            });
            return { kind: 'speak', content: 'ok' };
          },
          checkpoint: async () => ({ version: '1', data: null }),
        },
        release: async () => {},
      }),
    };
    const room = createRoundtable({
      conversationId: 'pricing',
      participants: [{ kind: 'agent', id: 'a', runtime: { id: 'echo', version: '1' }, factory }],
      selector: roundRobin(),
      store,
      pricing,
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    const [record] = room.snapshot().usage;
    expect(record.status === 'settled' && record.price).toEqual({
      version: 'v1',
      cost: { currency: 'USD', minorUnits: '5' },
    });
    await room.dispose();

    const registry = {
      resolveParticipant: async () => ({ reference: { id: 'echo', version: '1' }, factory }),
    };
    await expect(
      loadRoundtable({
        conversationId: 'pricing',
        store,
        registry,
        pricing: { version: 'v2', cost: () => null },
      }),
    ).rejects.toMatchObject({ code: 'invalid-config' });

    const reloaded = await loadRoundtable({ conversationId: 'pricing', store, registry, pricing });
    const [reloadedRecord] = reloaded.snapshot().usage;
    expect(reloadedRecord.status === 'settled' && reloadedRecord.price?.version).toBe('v1');
    await reloaded.dispose();
  });

  it('rejects a usage report with no prior admission unless it reports a cache hit', async () => {
    const room = createRoundtable({
      conversationId: 'unadmitted',
      participants: [
        agent('a', async (_turn, options) => {
          await expect(
            options.services.recordUsage({
              callId: 'never-admitted',
              outcome: 'completed',
              provenance: 'reported',
              final: true,
            }),
          ).rejects.toMatchObject({ code: 'conflict' });
          await options.services.recordUsage({
            callId: 'cache-1',
            outcome: 'cache-hit',
            provenance: 'reported',
            final: true,
          });
          return { kind: 'speak', content: 'ok' };
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    const usage = room.snapshot().usage;
    expect(usage.find((record) => record.callId === 'never-admitted')).toBeUndefined();
    expect(usage.find((record) => record.callId === 'cache-1')).toMatchObject({
      status: 'settled',
      outcome: 'cache-hit',
    });
    await room.dispose();
  });
});
