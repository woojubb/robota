import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  externalParticipant,
  loadRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ParticipantCheckpoint,
  type RoundtableRegistry,
} from './index';
import type { ConversationState } from './conversation-state';

function fixture() {
  const opened = vi.fn();
  const run = vi.fn();
  const release = vi.fn(async () => {});
  const participant: AgentParticipant = {
    kind: 'agent',
    id: 'agent',
    description: 'Independent reviewer',
    runtime: { id: 'fixture', version: '1' },
    factory: {
      checkpointVersions: ['1'],
      openSession: async ({ checkpoint }) => {
        opened(checkpoint);
        let count = checkpoint ? Number(checkpoint.data) : 0;
        return {
          session: {
            runTurn: async (turn) => {
              run(turn);
              return { kind: 'speak', content: String(++count) };
            },
            checkpoint: async () => ({ version: '1', data: count }),
          },
          release,
        };
      },
    },
  };
  const registry: RoundtableRegistry = {
    resolveParticipant: vi.fn(async () => ({
      reference: participant.runtime,
      factory: participant.factory,
    })),
  };
  return { participant, registry, opened, run, release };
}

describe('explicit conversation loading', () => {
  it('keeps the selected batch when only the current run has insufficient turn capacity', async () => {
    const f = fixture();
    const other = fixture();
    other.participant.id = 'other';
    other.participant.runtime.id = 'other';
    const reference = { id: 'stateful-batches', version: '1' };
    const makeSelector = (checkpoint?: ParticipantCheckpoint) => {
      let index = checkpoint ? Number(checkpoint.data) : 0;
      return {
        reference,
        checkpoint: async () => ({ version: '1', data: index }),
        select: () => {
          const step = index++;
          return step === 0
            ? { kind: 'speak' as const, participantId: 'agent' }
            : step === 1
              ? { kind: 'parallel' as const, participantIds: ['agent', 'other'] }
              : { kind: 'finish' as const, reason: 'all batches done' };
        },
      };
    };
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'deferred-selection',
      store,
      participants: [f.participant, other.participant],
      selector: makeSelector(),
      limits: { maxTurnsPerRun: 2 },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    await room.dispose();
    const loaded = await loadRoundtable({
      conversationId: 'deferred-selection',
      store,
      registry: {
        resolveParticipant: (runtime) => ({
          reference: runtime,
          factory: runtime.id === 'other' ? other.participant.factory : f.participant.factory,
        }),
        resolveSelector: () => ({
          reference,
          checkpointVersions: ['1'],
          create: ({ checkpoint }) => makeSelector(checkpoint),
        }),
      },
    });
    await loaded.run();
    expect(loaded.snapshot().messages.map((message) => message.participantId)).toEqual([
      'agent',
      'agent',
      'other',
    ]);
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(other.run).toHaveBeenCalledOnce();
    expect(await loaded.run()).toMatchObject({ status: 'completed', reason: 'all batches done' });
    await loaded.dispose();
  });

  it.each(['selected', 'group'] as const)(
    'does not accept unrelated input into a restored %s execution',
    async (boundary) => {
      const f = fixture();
      const store = new MemoryConversationStore();
      const commit = store.commit.bind(store);
      vi.spyOn(store, 'commit').mockImplementation(async (change) => {
        const state = change.state as unknown as ConversationState;
        if (
          state.phase.kind === 'group' &&
          (boundary === 'selected' || state.phase.members[0].status === 'running')
        ) {
          throw new Error('store disconnected');
        }
        return commit(change);
      });
      const room = createRoundtable({
        conversationId: boundary,
        store,
        participants: [f.participant, externalParticipant({ id: 'person' })],
        limits: { maxTurnsPerRun: 1 },
      });
      await room.run();
      await room.dispose();
      const loaded = await loadRoundtable({
        conversationId: boundary,
        store,
        registry: f.registry,
      });
      await expect(
        loaded.submitInput({
          participantId: 'person',
          inputId: 'unrelated',
          content: 'new required context',
          expectedRevision: loaded.snapshot().revision,
        }),
      ).rejects.toMatchObject({ code: 'conflict' });
      expect(loaded.snapshot().messages).toEqual([]);
      await loaded.dispose();
    },
  );

  it.each(['selected', 'prepared', 'mixed'] as const)(
    'recovers the %s commit boundary without repeating settled calls',
    async (boundary) => {
      const first = fixture();
      const second = fixture();
      second.participant.id = 'second';
      second.participant.runtime = { id: 'second-runtime', version: '1' };
      const reference = { id: 'parallel-then-finish', version: '1' };
      const select = vi.fn(({ turns }: { turns: readonly unknown[] }) =>
        turns.length
          ? { kind: 'finish' as const, reason: 'complete' }
          : { kind: 'parallel' as const, participantIds: ['agent', 'second'] },
      );
      const selector = { reference, select };
      const store = new MemoryConversationStore();
      const commit = store.commit.bind(store);
      let interrupted = false;
      vi.spyOn(store, 'commit').mockImplementation(async (change) => {
        const state = change.state as unknown as ConversationState;
        const phase = state.phase;
        const reached =
          boundary === 'selected'
            ? phase.kind === 'group'
            : boundary === 'prepared'
              ? state.snapshot.messages.length === 2
              : phase.kind === 'group' && phase.members[1].status === 'running';
        if (!interrupted && reached) {
          interrupted = true;
          throw new Error('connection lost before commit');
        }
        return commit(change);
      });
      const room = createRoundtable({
        conversationId: boundary,
        store,
        selector,
        participants: [first.participant, second.participant],
        limits: { maxTurnsPerRun: 2 },
      });
      expect(await room.run()).toMatchObject({ status: 'failed' });
      expect(room.snapshot().messages).toEqual([]);
      await room.dispose();
      const registry: RoundtableRegistry = {
        resolveParticipant: (runtime) => ({
          reference: runtime,
          factory:
            runtime.id === 'fixture' ? first.participant.factory : second.participant.factory,
        }),
        resolveSelector: () => ({ reference, create: () => selector }),
      };
      const loaded = await loadRoundtable({ conversationId: boundary, store, registry });
      const persisted = (await store.load(boundary))?.state as unknown as ConversationState;
      await loaded.run();
      expect(first.run).toHaveBeenCalledOnce();
      expect(second.run).toHaveBeenCalledOnce();
      expect(loaded.snapshot().messages.map((m) => m.participantId)).toEqual(['agent', 'second']);
      if (persisted.phase.kind === 'group') {
        expect(loaded.snapshot().messages.map((m) => m.id)).toEqual(
          persisted.phase.members.map((m) => m.messageId),
        );
        expect(second.run.mock.calls[0][0].turnId).toBe(persisted.phase.members[1].turn.turnId);
      }
      // The first selection is reused at every restart boundary.
      expect(select.mock.calls.filter(([context]) => context.turns.length === 0)).toHaveLength(1);
      await loaded.dispose();
    },
  );

  it.each(['selecting', 'running', 'settled'] as const)(
    'refuses uncertain %s work without calling the registry or runtime',
    async (boundary) => {
      const f = fixture();
      const store = new MemoryConversationStore();
      const commit = store.commit.bind(store);
      let stopWrites = false;
      vi.spyOn(store, 'commit').mockImplementation(async (change) => {
        if (stopWrites) throw new Error('store disconnected');
        const result = await commit(change);
        const state = change.state as unknown as ConversationState;
        stopWrites =
          boundary === 'selecting'
            ? state.phase.kind === 'selecting'
            : state.phase.kind === 'group' && state.phase.members[0].status === boundary;
        return result;
      });
      const room = createRoundtable({
        conversationId: boundary,
        store,
        participants: [f.participant],
        limits: { maxTurnsPerRun: 1 },
      });
      await room.run();
      await room.dispose();
      const calls = f.run.mock.calls.length;
      await expect(
        loadRoundtable({ conversationId: boundary, store, registry: f.registry }),
      ).rejects.toMatchObject({ code: 'recovery-required' });
      expect(f.registry.resolveParticipant).not.toHaveBeenCalled();
      expect(f.run).toHaveBeenCalledTimes(calls);
    },
  );

  it('preserves terminal outcomes without creating another session or altering stored state', async () => {
    const f = fixture();
    f.participant.factory.openSession = async () => ({
      session: { runTurn: async () => ({ kind: 'failed', message: 'runtime failed' }) },
      release: f.release,
    });
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'terminal',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1 },
    });
    const result = await room.run();
    await room.dispose();
    const before = await store.load('terminal');
    const open = vi.spyOn(f.participant.factory, 'openSession');
    const loaded = await loadRoundtable({
      conversationId: 'terminal',
      store,
      registry: f.registry,
    });
    expect(await loaded.run()).toEqual(result);
    expect(await store.load('terminal')).toEqual(before);
    expect(open).not.toHaveBeenCalled();
    await loaded.dispose();
  });

  it.each([
    'envelope',
    'schema',
    'context-version',
    'delivery-cursor',
    'message-author',
    'message-turn',
  ] as const)('rejects malformed %s before resolving runtimes', async (corruption) => {
    const f = fixture();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'corrupt',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    const envelope = (await store.load('corrupt'))!;
    const state = envelope.state as unknown as ConversationState;
    if (corruption === 'envelope') envelope.revision++;
    if (corruption === 'schema') Object.assign(state, { schemaVersion: 99 });
    if (corruption === 'context-version') state.definition.contextPolicy.version = '2';
    if (corruption === 'delivery-cursor') state.participants[0].delivered.push('missing');
    if (corruption === 'message-author') state.snapshot.messages[0].participantId = 'unknown';
    if (corruption === 'message-turn') {
      state.snapshot.turns = [];
      state.participants[0].checkpoint = null;
    }
    vi.spyOn(store, 'load').mockResolvedValue(envelope);
    await expect(
      loadRoundtable({ conversationId: 'corrupt', store, registry: f.registry }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect(f.registry.resolveParticipant).not.toHaveBeenCalled();
  });

  it('restores private state, registration order, context delivery and input receipts', async () => {
    const f = fixture();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'restore',
      store,
      participants: [externalParticipant({ id: 'person' }), f.participant],
      limits: { maxTurnsPerRun: 1 },
    });
    const waiting = await room.run();
    if (waiting.status !== 'waiting') throw new Error('Expected input request');
    const input = {
      participantId: 'person',
      inputId: 'reply',
      content: 'first prompt',
      replyToRequestId: waiting.requests[0].id,
      expectedRevision: waiting.revision,
    };
    const receipt = await room.submitInput(input);
    await room.run();
    await room.dispose();
    const loaded = await loadRoundtable({ conversationId: 'restore', store, registry: f.registry });
    expect(loaded.snapshot()).toEqual(room.snapshot());
    expect(f.opened).toHaveBeenCalledTimes(1); // Loading does not open a runtime or call a model.
    expect(await loaded.submitInput(input)).toEqual(receipt);
    const next = await loaded.run();
    if (next.status !== 'waiting') throw new Error('Expected next input request');
    await loaded.submitInput({
      participantId: 'person',
      inputId: 'reply-2',
      content: 'second prompt',
      replyToRequestId: next.requests[0].id,
      expectedRevision: next.revision,
    });
    await loaded.run();
    expect(f.opened.mock.calls).toEqual([[undefined], [{ version: '1', data: 1 }]]);
    expect(
      f.run.mock.calls[1][0].context.messages.map((m: { content: string }) => m.content),
    ).toEqual(['second prompt']);
    expect(loaded.snapshot().messages.map((m) => m.content)).toEqual([
      'first prompt',
      '1',
      'second prompt',
      '2',
    ]);
    await loaded.dispose();
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it('rejects runtime and checkpoint version mismatches before opening any session', async () => {
    const f = fixture();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'versions',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    await expect(
      loadRoundtable({
        conversationId: 'versions',
        store,
        registry: {
          resolveParticipant: () => ({
            reference: { id: 'fixture', version: '2' },
            factory: f.participant.factory,
          }),
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    await expect(
      loadRoundtable({
        conversationId: 'versions',
        store,
        registry: {
          resolveParticipant: () => ({
            reference: f.participant.runtime,
            factory: { ...f.participant.factory, checkpointVersions: ['2'] },
          }),
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect(f.opened).toHaveBeenCalledTimes(1);
  });

  it('refuses to reconstruct a used runtime from its public transcript when no checkpoint exists', async () => {
    const f = fixture();
    f.participant.factory.openSession = async () => ({
      session: { runTurn: async () => ({ kind: 'speak', content: 'only public output' }) },
      release: f.release,
    });
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'no-checkpoint',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    await expect(
      loadRoundtable({ conversationId: 'no-checkpoint', store, registry: f.registry }),
    ).rejects.toMatchObject({ code: 'recovery-required' });
  });

  it('restores a versioned selector checkpoint and does not replace its policy with round-robin', async () => {
    const f = fixture();
    const store = new MemoryConversationStore();
    const reference = { id: 'policy', version: '1' };
    const makeSelector = (checkpoint?: ParticipantCheckpoint) => {
      let selected = checkpoint ? Number(checkpoint.data) : 0;
      return {
        reference,
        select: () =>
          ++selected === 1
            ? { kind: 'speak' as const, participantId: 'agent' }
            : { kind: 'finish' as const, reason: 'policy complete' },
        checkpoint: async () => ({ version: '1', data: selected }),
      };
    };
    const room = createRoundtable({
      conversationId: 'selector',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1 },
      selector: makeSelector(),
    });
    await room.run();
    await room.dispose();
    const create = vi.fn(async ({ checkpoint }: { checkpoint?: ParticipantCheckpoint }) =>
      makeSelector(checkpoint),
    );
    const loaded = await loadRoundtable({
      conversationId: 'selector',
      store,
      registry: {
        ...f.registry,
        resolveSelector: () => ({ reference, checkpointVersions: ['1'], create }),
      },
    });
    expect(create).toHaveBeenCalledWith({ checkpoint: { version: '1', data: 1 } });
    expect(await loaded.run()).toMatchObject({ status: 'completed', reason: 'policy complete' });
    expect(f.run).toHaveBeenCalledOnce();
    await loaded.dispose();
  });

  it('checks the loaded revision again under the claim before dispatching a stale handle', async () => {
    const f = fixture();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'stale',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    const first = await loadRoundtable({ conversationId: 'stale', store, registry: f.registry });
    const stale = await loadRoundtable({ conversationId: 'stale', store, registry: f.registry });
    await first.run();
    await expect(stale.run()).rejects.toMatchObject({ code: 'conflict' });
    expect(f.run).toHaveBeenCalledTimes(2);
    await first.dispose();
    await stale.dispose();
  });
});
