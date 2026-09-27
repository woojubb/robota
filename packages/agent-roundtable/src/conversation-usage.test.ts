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

  it('a rejected admission mid-turn ends only the run; the next run dispatches the member again', async () => {
    const store = new MemoryConversationStore();
    const turns: ParticipantTurn[] = [];
    const participant = agent('a', async (turn, options) => {
      turns.push(turn);
      const calls = turns.length === 1 ? 2 : 1;
      for (let call = 0; call < calls; call++)
        await options.services.admitModelCall({
          callId: `${turn.attemptId}-${call}`,
          providerId: 'p',
          modelId: 'm',
        });
      return { kind: 'speak', content: 'spoke' };
    });
    const openSession = participant.factory.openSession;
    const sessions = { opened: 0, released: 0 };
    participant.factory.openSession = async (context) => {
      sessions.opened++;
      const lease = await openSession(context);
      return { ...lease, release: async () => void sessions.released++ };
    };
    const room = createRoundtable({
      conversationId: 'limit-mid-turn',
      store,
      participants: [participant],
      limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 1 },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
    expect(room.snapshot().messages).toEqual([]);
    expect((await store.load('limit-mid-turn'))?.state).toMatchObject({ terminal: null });
    // The stopped attempt is discarded like a cancelled one, including the session that ran it.
    expect(sessions).toEqual({ opened: 1, released: 1 });

    // A new run has a fresh per-run allowance, so the stopped attempt runs again for the same turn.
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(room.snapshot().messages.map((message) => message.content)).toEqual(['spoke']);
    expect(turns).toHaveLength(2);
    expect(turns[1].turnId).toBe(turns[0].turnId);
    expect(turns[1].attemptId).not.toBe(turns[0].attemptId);
    expect(room.snapshot().usage).toHaveLength(2);
    expect(sessions).toEqual({ opened: 2, released: 1 });
    await room.dispose();
  });

  it('a rejected admission stops running siblings, and the next run dispatches them again', async () => {
    const store = new MemoryConversationStore();
    const bRunning = deferred<void>();
    const runs = { a: 0, b: 0 };
    const room = createRoundtable({
      conversationId: 'limit-siblings',
      store,
      participants: [
        agent('a', async (turn, options) => {
          const calls = ++runs.a === 1 ? 3 : 1;
          await bRunning.promise;
          for (let call = 0; call < calls; call++)
            await options.services.admitModelCall({
              callId: `${turn.attemptId}-${call}`,
              providerId: 'p',
              modelId: 'm',
            });
          return { kind: 'speak', content: 'a' };
        }),
        agent('b', async (_turn, { signal }) => {
          if (++runs.b > 1) return { kind: 'speak', content: 'b' };
          bRunning.resolve();
          return new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        }),
      ],
      maxConcurrentParticipants: 2,
      limits: { maxTurnsPerRun: 3, maxModelCallsPerRun: 2 },
      selector: {
        modelCalls: 'none',
        select: ({ turns }) =>
          turns.length
            ? { kind: 'finish', reason: 'done' }
            : { kind: 'parallel', participantIds: ['a', 'b'] },
      },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
    expect((await store.load('limit-siblings'))?.state).toMatchObject({ terminal: null });
    expect(room.snapshot().messages).toEqual([]);
    expect(await room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(room.snapshot().messages.map((message) => message.content)).toEqual(['a', 'b']);
    expect(runs).toEqual({ a: 2, b: 2 });
    await room.dispose();
  });

  it('a sibling failure that precedes a rejected admission stays final', async () => {
    const room = createRoundtable({
      conversationId: 'limit-after-failure',
      participants: [
        agent('a', async (_turn, options) => {
          // The sibling failure stops this group before the call the limit rejects.
          await new Promise((resolve) =>
            options.signal.addEventListener('abort', resolve, { once: true }),
          );
          for (let call = 0; call < 3; call++)
            await options.services.admitModelCall({
              callId: `a-${call}`,
              providerId: 'p',
              modelId: 'm',
            });
          return { kind: 'speak', content: 'a' };
        }),
        agent('b', async () => ({ kind: 'failed', message: 'b failed' })),
      ],
      maxConcurrentParticipants: 2,
      limits: { maxTurnsPerRun: 2, maxModelCallsPerRun: 2 },
      selector: {
        modelCalls: 'none',
        select: () => ({ kind: 'parallel', participantIds: ['a', 'b'] }),
      },
    });
    const result = await room.run();
    expect(result).toMatchObject({ status: 'failed', message: 'b failed' });
    expect(await room.run()).toEqual(result);
    await room.dispose();
  });

  it('a rejected selector admission ends the run, and the next run asks the selector again', async () => {
    const store = new MemoryConversationStore();
    let selections = 0;
    const room = createRoundtable({
      conversationId: 'limit-selector',
      store,
      participants: [agent('a', async () => ({ kind: 'speak', content: 'a' }))],
      selector: {
        modelCalls: 'metered',
        select: async (_context, { services }) => {
          const calls = ++selections === 1 ? 2 : 1;
          for (let call = 0; call < calls; call++)
            await services.admitModelCall({
              callId: `select-${selections}-${call}`,
              providerId: 'p',
              modelId: 'm',
            });
          return { kind: 'finish', reason: 'done' };
        },
      },
      limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 1 },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
    expect((await store.load('limit-selector'))?.state).toMatchObject({
      terminal: null,
      phase: { kind: 'ready' },
    });
    expect(await room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(selections).toBe(2);
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

  describe('a spent conversation or participant limit refuses work before dispatch', () => {
    /** Each turn admits one call; the selector script picks the next selection by turn count. */
    function metered(id: string) {
      const run = vi.fn(async (turn: ParticipantTurn, options: ParticipantExecutionOptions) => {
        await options.services.admitModelCall({
          callId: `${turn.attemptId}-call`,
          providerId: 'p',
          modelId: 'm',
        });
        return { kind: 'speak' as const, content: id };
      });
      return { participant: agent(id, run), run };
    }

    it('an exhausted conversation limit refuses the next group before any runtime is called', async () => {
      const store = new MemoryConversationStore();
      const a = metered('a');
      const room = createRoundtable({
        conversationId: 'precheck-conversation',
        store,
        participants: [a.participant],
        limits: { maxTurnsPerRun: 2, maxModelCallsPerConversation: 1 },
      });
      expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
      expect(room.snapshot().messages.map((message) => message.content)).toEqual(['a']);
      expect(a.run).toHaveBeenCalledOnce();
      expect((await store.load('precheck-conversation'))?.state).toMatchObject({ terminal: null });
      expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
      expect(a.run).toHaveBeenCalledOnce();
      await room.dispose();
    });

    it('an exhausted participant limit refuses the whole group containing that participant before dispatch', async () => {
      const a = metered('a');
      const b = metered('b');
      const room = createRoundtable({
        conversationId: 'precheck-participant-group',
        participants: [a.participant, b.participant],
        maxConcurrentParticipants: 2,
        limits: { maxTurnsPerRun: 3, maxModelCallsPerParticipant: 1 },
        selector: {
          modelCalls: 'none',
          select: ({ turns }) =>
            turns.length
              ? { kind: 'parallel', participantIds: ['a', 'b'] }
              : { kind: 'speak', participantId: 'a' },
        },
      });
      expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
      expect(a.run).toHaveBeenCalledOnce();
      expect(b.run).not.toHaveBeenCalled();
      expect(room.snapshot().messages.map((message) => message.content)).toEqual(['a']);
      await room.dispose();
    });

    it('a group without the exhausted participant still runs', async () => {
      const a = metered('a');
      const b = metered('b');
      const room = createRoundtable({
        conversationId: 'precheck-participant-other',
        participants: [a.participant, b.participant],
        limits: { maxTurnsPerRun: 3, maxModelCallsPerParticipant: 1 },
        selector: {
          modelCalls: 'none',
          select: ({ turns }) =>
            turns.length === 0
              ? { kind: 'speak', participantId: 'a' }
              : turns.length === 1
                ? { kind: 'speak', participantId: 'b' }
                : { kind: 'finish', reason: 'done' },
        },
      });
      expect(await room.run()).toMatchObject({ status: 'completed', reason: 'done' });
      expect(room.snapshot().messages.map((message) => message.content)).toEqual(['a', 'b']);
      await room.dispose();
    });

    it('a member stopped by a spent participant limit is not dispatched again while it stays spent', async () => {
      const run = vi.fn(async (turn: ParticipantTurn, options: ParticipantExecutionOptions) => {
        for (let call = 0; call < 2; call++)
          await options.services.admitModelCall({
            callId: `${turn.attemptId}-${call}`,
            providerId: 'p',
            modelId: 'm',
          });
        return { kind: 'speak' as const, content: 'a' };
      });
      const room = createRoundtable({
        conversationId: 'precheck-restored',
        participants: [agent('a', run)],
        limits: { maxTurnsPerRun: 1, maxModelCallsPerParticipant: 1 },
      });
      expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
      expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
      expect(run).toHaveBeenCalledOnce();
      await room.dispose();
    });

    it('a metered selector is not called when the conversation limit is exhausted', async () => {
      const a = metered('a');
      const select = vi.fn(async (_context: unknown, options: { services: TurnServices }) => {
        await options.services.admitModelCall({
          callId: crypto.randomUUID(),
          providerId: 'p',
          modelId: 'm',
        });
        return { kind: 'speak' as const, participantId: 'a' };
      });
      const room = createRoundtable({
        conversationId: 'precheck-selector',
        participants: [a.participant],
        selector: { modelCalls: 'metered', select },
        limits: { maxTurnsPerRun: 2, maxModelCallsPerConversation: 2 },
      });
      expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
      expect(select).toHaveBeenCalledOnce();
      expect(a.run).toHaveBeenCalledOnce();
      expect(room.snapshot().usage).toHaveLength(2);
      await room.dispose();
    });
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

  it('rejects a usage report with no prior admission unless it reports a cache hit, which then needs its own identity', async () => {
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
          // A cache hit needs no admission, but without one it must carry providerId and modelId
          // itself; nothing else would fix its identity, and it must never be stored empty.
          await expect(
            options.services.recordUsage({
              callId: 'cache-1',
              outcome: 'cache-hit',
              provenance: 'reported',
              final: true,
            }),
          ).rejects.toMatchObject({ code: 'invalid-config' });
          await options.services.recordUsage({
            callId: 'cache-1',
            outcome: 'cache-hit',
            provenance: 'reported',
            providerId: 'p',
            modelId: 'm',
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
      providerId: 'p',
      modelId: 'm',
    });
    await room.dispose();
  });

  it('an admission-free cache hit does not spend the run call-limit allowance a real call still needs', async () => {
    let admissionError: unknown;
    const room = createRoundtable({
      conversationId: 'cache-hit-allowance',
      participants: [
        agent('a', async (_turn, options) => {
          await options.services.recordUsage({
            callId: 'hit-1',
            outcome: 'cache-hit',
            provenance: 'reported',
            providerId: 'p',
            modelId: 'm',
            final: true,
          });
          try {
            await options.services.admitModelCall({
              callId: 'real-1',
              providerId: 'p',
              modelId: 'm',
            });
          } catch (error) {
            admissionError = error;
          }
          return { kind: 'speak' as const, content: 'ok' };
        }),
      ],
      limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 1 },
    });
    // The run still ends 'limited' because it reached its one-turn cap, not because the real call
    // was refused — a run limited by 'model-calls' here would mean the cache hit spent the
    // allowance the real call went on to need.
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(admissionError).toBeUndefined();
    const usage = room.snapshot().usage;
    expect(usage.find((record) => record.callId === 'hit-1')).toMatchObject({ admitted: false });
    expect(usage.find((record) => record.callId === 'real-1')).toMatchObject({ admitted: true });
    await room.dispose();
  });

  it('reloads a conversation whose ledger holds an admission-free cache hit', async () => {
    const store = new MemoryConversationStore();
    const factory: ParticipantFactory = {
      modelCalls: 'metered',
      checkpointVersions: ['1'],
      openSession: async () => ({
        session: {
          runTurn: async (_turn, options) => {
            await options.services.recordUsage({
              callId: 'cache-1',
              outcome: 'cache-hit',
              provenance: 'reported',
              providerId: 'p',
              modelId: 'm',
              final: true,
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
      conversationId: 'reload-cache-hit',
      participants: [participant],
      store,
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    await room.dispose();

    const loaded = await loadRoundtable({ conversationId: 'reload-cache-hit', store, registry });
    expect(loaded.snapshot().usage).toMatchObject([
      { callId: 'cache-1', status: 'settled', providerId: 'p', modelId: 'm' },
    ]);
    await loaded.dispose();
  });

  it('rejects fractional or unrecognized-key tokens before they are ever stored', async () => {
    const room = createRoundtable({
      conversationId: 'fractional-tokens',
      participants: [
        agent('a', async (_turn, options) => {
          await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
          // Reporters must round fractional provider counts; a fractional count is rejected, not stored.
          await expect(
            options.services.recordUsage({
              callId: 'c1',
              outcome: 'completed',
              provenance: 'estimated',
              tokens: { input: 12.5 },
              final: true,
            }),
          ).rejects.toMatchObject({ code: 'invalid-config' });
          await expect(
            options.services.recordUsage({
              callId: 'c1',
              outcome: 'completed',
              provenance: 'estimated',
              tokens: { input: 12, notARecognizedKey: 1 } as never,
              final: true,
            }),
          ).rejects.toMatchObject({ code: 'invalid-config' });
          return { kind: 'speak', content: 'ok' };
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    expect(room.snapshot().usage.find((r) => r.callId === 'c1')).toMatchObject({
      status: 'reserved',
    });
    await room.dispose();
  });

  it('rejects a settlement whose pricing cost is not an integer amount string, before it is stored, and summarizeUsage still never throws', async () => {
    const pricing: PricePolicy = {
      version: 'v1',
      cost: () => ({ currency: 'USD', minorUnits: '1.5' }),
    };
    const room = createRoundtable({
      conversationId: 'bad-pricing-cost',
      participants: [
        agent('a', async (_turn, options) => {
          await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
          await expect(
            options.services.recordUsage({
              callId: 'c1',
              outcome: 'completed',
              provenance: 'reported',
              final: true,
            }),
          ).rejects.toMatchObject({ code: 'invalid-config' });
          return { kind: 'speak', content: 'ok' };
        }),
      ],
      selector: roundRobin(),
      pricing,
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    const usage = room.snapshot().usage;
    expect(usage.find((r) => r.callId === 'c1')).toMatchObject({ status: 'reserved' });
    expect(() => summarizeUsage(usage)).not.toThrow();
    await room.dispose();
  });

  it('a response that settles after the run stops on a timeout still records its tokens; a new admission afterward is refused', async () => {
    let secondAdmissionError: unknown;
    const room = createRoundtable({
      conversationId: 'late-settlement',
      participants: [
        agent('a', async (_turn, options) => {
          await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
          // The provider response arrives well after the run's timeout already fired.
          await new Promise((resolve) => setTimeout(resolve, 100));
          await options.services.recordUsage({
            callId: 'c1',
            outcome: 'completed',
            provenance: 'reported',
            tokens: { input: 5, output: 10 },
            final: true,
          });
          try {
            await options.services.admitModelCall({ callId: 'c2', providerId: 'p', modelId: 'm' });
          } catch (error) {
            secondAdmissionError = error;
          }
          return { kind: 'speak', content: 'late' };
        }),
      ],
      limits: { maxTurnsPerRun: 1, timeoutMs: 30 },
    });
    const result = await room.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'time' });
    expect(room.snapshot().usage.find((r) => r.callId === 'c1')).toMatchObject({
      status: 'settled',
      outcome: 'completed',
      tokens: { input: 5, output: 10 },
    });
    expect(secondAdmissionError).toBeDefined();
    await room.dispose();
  });

  describe('the pre-dispatch group limit check', () => {
    it('needs no allowance for a participant whose factory declares modelCalls "none", like a "none" selector', async () => {
      const silent: AgentParticipant = {
        kind: 'agent',
        id: 'silent',
        runtime: { id: 'silent', version: '1' },
        factory: {
          modelCalls: 'none',
          openSession: async () => ({
            session: { runTurn: async () => ({ kind: 'speak', content: 'silent' }) },
            release: async () => {},
          }),
        },
      };
      const metered = agent('metered', async (_turn, options) => {
        await options.services.admitModelCall({ callId: 'm-1', providerId: 'p', modelId: 'm' });
        return { kind: 'speak', content: 'metered' };
      });
      const room = createRoundtable({
        conversationId: 'none-member-allowance',
        participants: [silent, metered],
        maxConcurrentParticipants: 2,
        limits: { maxTurnsPerRun: 2, maxModelCallsPerRun: 1 },
        selector: {
          modelCalls: 'none',
          select: () => ({ kind: 'parallel', participantIds: ['silent', 'metered'] }),
        },
      });
      // Before the fix, 'silent' counted toward the needed allowance and the group was refused
      // whole even though only 'metered' would ever spend it.
      const result = await room.run();
      expect(result).toMatchObject({ status: 'limited', reason: 'turns' });
      expect(
        room
          .snapshot()
          .messages.map((message) => message.content)
          .sort(),
      ).toEqual(['metered', 'silent']);
      await room.dispose();
    });
  });
});
