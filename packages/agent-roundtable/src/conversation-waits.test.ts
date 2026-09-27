import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  externalParticipant,
  loadRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ParticipantRequest,
  type Roundtable,
  type RoundtableRegistry,
  type ParticipantTurn,
  type ParticipantResponse,
  type ResumeRequest,
  type ExternalInput,
  type TurnSelector,
} from './index';
import type { ConversationState } from './conversation-state';

const rooms: Roundtable[] = [];
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => room.dispose()));
});

function member(id: string, requests?: ParticipantRequest[]) {
  const run = vi.fn();
  const resumed = vi.fn();
  const opened = vi.fn();
  const participant: AgentParticipant = {
    id,
    kind: 'agent',
    runtime: { id, version: '1' },
    factory: {
      supportsContinuation: true,
      checkpointVersions: ['1'],
      openSession: async ({ checkpoint }) => {
        opened(checkpoint);
        let state = checkpoint?.data ?? 'new';
        return {
          release: async () => {},
          session: {
            runTurn: async (turn: ParticipantTurn) => {
              run(turn);
              state = requests ? 'waiting' : 'done';
              return requests
                ? { kind: 'wait' as const, requests }
                : { kind: 'speak' as const, content: id };
            },
            resumeTurn: async (
              turn: ParticipantTurn,
              responses: readonly ParticipantResponse[],
            ) => {
              resumed(turn, responses, state);
              state = 'done';
              return { kind: 'speak' as const, content: id };
            },
            checkpoint: async () => ({ version: '1', data: state }),
          },
        };
      },
    },
  };
  return { participant, run, resumed, opened };
}

function setup(input = false, bothWait = false) {
  const first = member(
    'first',
    input
      ? [{ id: 'first-request', kind: 'input', participantId: 'person', reason: 'Need details' }]
      : [
          {
            id: 'first-request',
            kind: 'approval',
            reason: 'Approve action',
            data: { actionId: 'action-1', arguments: { path: '/fixture' } },
          },
        ],
  );
  const second = member(
    'second',
    bothWait
      ? [
          {
            id: 'second-request',
            kind: 'approval',
            reason: 'Approve another action',
            data: { actionId: 'action-2' },
          },
        ]
      : undefined,
  );
  const store = new MemoryConversationStore();
  const select = vi.fn(({ turns }) =>
    turns.length
      ? { kind: 'finish' as const, reason: 'done' }
      : { kind: 'parallel' as const, participantIds: ['first', 'second'] },
  );
  const selector: TurnSelector = { reference: { id: 'two-members', version: '1' }, select };
  const room = createRoundtable({
    conversationId: crypto.randomUUID(),
    store,
    participants: [
      first.participant,
      second.participant,
      externalParticipant({ id: 'person' }),
      externalParticipant({ id: 'other-person' }),
    ],
    selector,
    maxConcurrentParticipants: 1,
    limits: { maxTurnsPerRun: 2 },
  });
  rooms.push(room);
  const registry: RoundtableRegistry = {
    resolveParticipant: (reference) => ({
      reference,
      factory: reference.id === 'first' ? first.participant.factory : second.participant.factory,
    }),
    resolveSelector: () => ({ reference: selector.reference!, create: () => selector }),
  };
  const load = async () => {
    const loaded = await loadRoundtable({
      conversationId: room.snapshot().conversationId,
      store,
      registry,
    });
    rooms.push(loaded);
    return loaded;
  };
  const approve = (target: Roundtable, requestId = 'first-request', responseId = 'approval-1') =>
    target.resume({
      requestId,
      responseId,
      expectedRevision: target.snapshot().revision,
      response: { kind: 'approval', approved: true },
    });
  return { room, store, first, second, select, registry, load, approve };
}

describe('checkpointed member waits', () => {
  it('rejects a missing delivery cursor for input already consumed by the requesting member', async () => {
    const f = setup(true);
    await f.room.run();
    await f.room.resume({
      requestId: 'first-request',
      responseId: 'input',
      expectedRevision: f.room.snapshot().revision,
      response: { kind: 'input', content: 'already consumed privately' },
    });
    await f.room.run();
    await f.room.dispose();
    const envelope = (await f.store.load(f.room.snapshot().conversationId))!;
    const state = envelope.state as unknown as ConversationState;
    state.participants.find((participant) => participant.id === 'first')!.delivered = [];
    vi.spyOn(f.store, 'load').mockResolvedValue(envelope);
    const resolve = vi.spyOn(f.registry, 'resolveParticipant');
    await expect(f.load()).rejects.toMatchObject({ code: 'invalid-config' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(['null-response', 'numeric-request', 'numeric-response', 'numeric-input'] as const)(
    'rejects malformed %s before changing request state',
    async (malformed) => {
      const f = setup(true);
      await f.room.run();
      const before = f.room.snapshot();
      const response = {
        requestId: 'first-request',
        responseId: 'reply',
        expectedRevision: before.revision,
        response: { kind: 'input', content: 'answer' },
      };
      if (malformed === 'null-response') Object.assign(response, { response: null });
      if (malformed === 'numeric-request') Object.assign(response, { requestId: 123 });
      if (malformed === 'numeric-response') Object.assign(response, { responseId: 123 });
      const submitted =
        malformed === 'numeric-input'
          ? f.room.submitInput({
              participantId: 'person',
              inputId: 123,
              expectedRevision: before.revision,
              replyToRequestId: 'first-request',
              content: 'answer',
            } as unknown as ExternalInput)
          : f.room.resume(response as unknown as ResumeRequest);
      await expect(submitted).rejects.toMatchObject({ code: 'conflict' });
      expect(f.room.snapshot()).toEqual(before);
      expect(f.first.resumed).not.toHaveBeenCalled();
    },
  );

  it('rejects a restored continuation capability mismatch without opening a runtime', async () => {
    const f = setup();
    await f.room.run();
    await f.room.dispose();
    f.first.participant.factory.supportsContinuation = false;
    await expect(f.load()).rejects.toMatchObject({ code: 'invalid-config' });
    expect(f.first.opened).toHaveBeenCalledOnce();
    expect(f.second.opened).toHaveBeenCalledOnce();
  });

  it('owns the returned wait before invoking runtime checkpoint code', async () => {
    const f = setup(true);
    const request: ParticipantRequest = {
      id: 'first-request',
      kind: 'input',
      participantId: 'person',
      reason: 'Original target',
    };
    f.first.participant.factory.openSession = async () => ({
      release: async () => {},
      session: {
        runTurn: async () => ({ kind: 'wait', requests: [request] }),
        resumeTurn: async () => ({ kind: 'speak', content: 'finished' }),
        checkpoint: async () => {
          Object.assign(request, { participantId: 'other-person' });
          return { version: '1', data: 'waiting' };
        },
      },
    });
    expect(await f.room.run()).toMatchObject({
      status: 'waiting',
      requests: [{ participantId: 'person' }],
    });
    await f.room.dispose();
    expect((await f.load()).snapshot().requests[0].participantId).toBe('person');
  });

  it('keeps multiple wait cycles private and delivers committed input only to unconsumed peers', async () => {
    const f = setup(true);
    f.select.mockImplementation(({ turns }) =>
      turns.filter((turn: { participantId: string }) => turn.participantId === 'first').length >= 2
        ? { kind: 'finish', reason: 'done' }
        : { kind: 'parallel', participantIds: ['first', 'second'] },
    );
    f.first.participant.factory.openSession = async ({ checkpoint }) => {
      let step = checkpoint ? Number(checkpoint.data) : 0;
      return {
        release: async () => {},
        session: {
          runTurn: async (turn) => {
            f.first.run(turn);
            if (step > 0) return { kind: 'speak', content: 'next group' };
            step = 1;
            return {
              kind: 'wait',
              requests: ['input-a', 'input-b'].map((id) => ({
                id,
                kind: 'input',
                participantId: 'person',
                reason: 'Need details',
              })),
            };
          },
          resumeTurn: async (turn, responses) => {
            f.first.resumed(turn, responses);
            if (step++ === 1)
              return {
                kind: 'wait',
                requests: [
                  {
                    id: 'approval',
                    kind: 'approval',
                    reason: 'Approve informed action',
                    data: {},
                  },
                ],
              };
            return { kind: 'speak', content: 'first' };
          },
          checkpoint: async () => ({ version: '1', data: step }),
        },
      };
    };
    await f.room.run();
    for (const requestId of ['input-a', 'input-b']) {
      await f.room.resume({
        requestId,
        responseId: `reply-${requestId}`,
        expectedRevision: f.room.snapshot().revision,
        response: { kind: 'input', content: requestId },
      });
      expect(await f.room.run()).toMatchObject({ status: 'waiting' });
      expect(f.room.snapshot().messages).toEqual([]);
    }
    expect(f.first.resumed).toHaveBeenCalledOnce();
    expect(
      f.first.resumed.mock.calls[0][1].map((value: ParticipantResponse) => value.request.id),
    ).toEqual(['input-a', 'input-b']);
    await f.room.dispose();
    const next = await f.load();
    await f.approve(next, 'approval', 'reply-approval');
    await next.run();
    expect(
      f.first.resumed.mock.calls[1][1].map((value: ParticipantResponse) => value.request.id),
    ).toEqual(['approval']);
    expect(next.snapshot().messages.map((message) => message.content)).toEqual([
      'input-a',
      'input-b',
      'first',
      'second',
    ]);
    await next.dispose();
    const following = await f.load();
    await following.run();
    expect(
      f.first.run.mock.calls[1][0].context.messages.map(
        (message: { content: string }) => message.content,
      ),
    ).toEqual(['second']);
    expect(
      f.second.run.mock.calls[1][0].context.messages.map(
        (message: { content: string }) => message.content,
      ),
    ).toEqual(['input-a', 'input-b', 'first']);
    await following.dispose();
    const finished = await f.load();
    expect(await finished.run()).toMatchObject({ status: 'completed' });
    expect(finished.snapshot().messages).toHaveLength(6);
  });

  it.each(['before', 'after'] as const)(
    'recovers response persistence failure %s commit without executing',
    async (boundary) => {
      const f = setup();
      await f.room.run();
      const input = {
        requestId: 'first-request',
        responseId: 'reply',
        expectedRevision: f.room.snapshot().revision,
        response: { kind: 'approval' as const, approved: true },
      };
      const commit = f.store.commit.bind(f.store);
      const failing = vi.spyOn(f.store, 'commit').mockImplementationOnce(async (change) => {
        if (boundary === 'after') await commit(change);
        throw new Error('connection lost');
      });
      if (boundary === 'before')
        await expect(f.room.resume(input)).rejects.toThrow('connection lost');
      else await f.room.resume(input);
      expect(f.first.resumed).not.toHaveBeenCalled();
      failing.mockRestore();
      await f.room.dispose();
      const loaded = await f.load();
      const receipt = await loaded.resume(input);
      expect(await loaded.resume(input)).toEqual(receipt);
      await loaded.run();
      expect(f.first.resumed).toHaveBeenCalledOnce();
      expect(f.second.run).toHaveBeenCalledOnce();
    },
  );

  it.each(['submitInput', 'resume'] as const)(
    'shares a standalone external input receipt after %s and reload',
    async (method) => {
      const store = new MemoryConversationStore();
      const room = createRoundtable({
        conversationId: crypto.randomUUID(),
        store,
        participants: [externalParticipant({ id: 'person' })],
        limits: { maxTurnsPerRun: 1 },
      });
      rooms.push(room);
      await room.run();
      const requestId = room.snapshot().requests[0].id;
      const input = {
        participantId: 'person',
        inputId: 'reply',
        content: 'answer',
        replyToRequestId: requestId,
        expectedRevision: room.snapshot().revision,
      };
      const response = {
        requestId,
        responseId: input.inputId,
        expectedRevision: input.expectedRevision,
        response: { kind: 'input' as const, content: input.content },
      };
      if (method === 'submitInput') await room.submitInput(input);
      else await room.resume(response);
      const before = room.snapshot();
      await room.dispose();
      const loaded = await loadRoundtable({
        conversationId: before.conversationId,
        store,
        registry: {
          resolveParticipant: () => {
            throw new Error('No agent required');
          },
        },
      });
      rooms.push(loaded);
      expect(await loaded.submitInput(input)).toMatchObject({ revision: before.revision });
      expect(await loaded.resume(response)).toMatchObject({ revision: before.revision });
      expect(loaded.snapshot()).toEqual(before);
    },
  );

  for (const boundary of ['pending', 'accepted'] as const) {
    it.each(['target', 'reason', 'kind', 'data'] as const)(
      `rejects a ${boundary} request whose %s differs from its original wait`,
      async (field) => {
        const f = setup(field === 'target');
        await f.room.run();
        if (boundary === 'accepted') {
          await f.room.resume({
            requestId: 'first-request',
            responseId: 'reply',
            expectedRevision: f.room.snapshot().revision,
            response:
              field === 'target'
                ? { kind: 'input', content: 'answer' }
                : { kind: 'approval', approved: true },
          });
        }
        await f.room.dispose();
        const envelope = (await f.store.load(f.room.snapshot().conversationId))!;
        const state = envelope.state as unknown as ConversationState;
        if (state.phase.kind !== 'group' || state.phase.members[0].outcome?.kind !== 'wait')
          throw new Error('Expected saved member wait');
        const original = state.phase.members[0].outcome.requests[0];
        if (field === 'target') Object.assign(original, { participantId: 'other-person' });
        if (field === 'reason') original.reason = 'A different explanation';
        if (field === 'kind') Object.assign(original, { kind: 'reconciliation' });
        if (field === 'data') Object.assign(original, { data: { actionId: 'another-action' } });
        vi.spyOn(f.store, 'load').mockResolvedValue(envelope);
        const resolve = vi.spyOn(f.registry, 'resolveParticipant');
        await expect(f.load()).rejects.toMatchObject({ code: 'invalid-config' });
        expect(resolve).not.toHaveBeenCalled();
      },
    );
  }

  it.each(['published', 'member-message', 'member-turn'] as const)(
    'rejects provisional input with %s publication identities before resolving runtimes',
    async (corruption) => {
      const f = setup(true);
      await f.room.run();
      await f.room.resume({
        requestId: 'first-request',
        responseId: 'input',
        expectedRevision: f.room.snapshot().revision,
        response: { kind: 'input', content: 'answer' },
      });
      await f.room.dispose();
      const envelope = (await f.store.load(f.room.snapshot().conversationId))!;
      const state = envelope.state as unknown as ConversationState;
      if (state.phase.kind !== 'group') throw new Error('Expected saved group');
      const entry = state.responses[0];
      if (corruption === 'published') {
        state.snapshot.messages.push({
          id: entry.inputMessageId!,
          turnId: entry.inputTurnId!,
          groupId: state.phase.groupId,
          participantId: 'person',
          content: 'answer',
          revision: entry.result.revision,
        });
        state.snapshot.turns.push({
          id: entry.inputTurnId!,
          groupId: state.phase.groupId,
          participantId: 'person',
          outcome: 'speak',
        });
      } else if (corruption === 'member-message') {
        entry.inputMessageId = state.phase.members[1].messageId;
        state.inputs[0].result.messageId = entry.inputMessageId;
      } else entry.inputTurnId = state.phase.members[1].turn.turnId;
      vi.spyOn(f.store, 'load').mockResolvedValue(envelope);
      const resolve = vi.spyOn(f.registry, 'resolveParticipant');
      await expect(f.load()).rejects.toMatchObject({ code: 'invalid-config' });
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it('settles siblings, accepts approval without executing, then resumes only the waiting member', async () => {
    const f = setup();
    expect(await f.room.run()).toMatchObject({
      status: 'waiting',
      requests: [{ id: 'first-request', memberId: 'first', kind: 'approval' }],
    });
    expect(f.second.run).toHaveBeenCalledOnce();
    expect(f.room.snapshot().messages).toEqual([]);
    expect(f.room.snapshot().turns).toEqual([]);
    await f.approve(f.room);
    expect(f.first.resumed).not.toHaveBeenCalled();
    expect(await f.room.run()).toMatchObject({ status: 'completed' });
    expect(f.first.run).toHaveBeenCalledOnce();
    expect(f.second.run).toHaveBeenCalledOnce();
    expect(f.first.resumed).toHaveBeenCalledOnce();
    expect(f.first.resumed.mock.calls[0][0]).toEqual(f.first.run.mock.calls[0][0]);
    expect(f.first.resumed.mock.calls[0][1][0]).toMatchObject({
      request: { id: 'first-request', memberId: 'first' },
      response: { kind: 'approval', approved: true },
    });
    expect(f.room.snapshot().messages.map((message) => message.content)).toEqual([
      'first',
      'second',
    ]);
  });

  it('restores a wait checkpoint and prepared sibling before and after response acceptance', async () => {
    const f = setup();
    expect(await f.room.run()).toMatchObject({ status: 'waiting' });
    await f.room.dispose();
    const waiting = await f.load();
    expect(await waiting.run()).toMatchObject({ status: 'waiting' });
    expect(f.first.opened).toHaveBeenCalledOnce();
    await f.approve(waiting);
    await waiting.dispose();
    const ready = await f.load();
    expect(await ready.run()).toMatchObject({ status: 'completed' });
    expect(f.first.resumed.mock.calls[0][2]).toBe('waiting');
    expect(f.first.run).toHaveBeenCalledOnce();
    expect(f.second.run).toHaveBeenCalledOnce();
    expect(f.second.opened).toHaveBeenCalledOnce();
  });

  it('deduplicates responses before stale revision checks and refuses conflicting deliveries', async () => {
    const f = setup();
    await f.room.run();
    const input = {
      requestId: 'first-request',
      responseId: 'reply',
      expectedRevision: f.room.snapshot().revision,
      response: { kind: 'approval' as const, approved: true },
    };
    const receipt = await f.room.resume(input);
    expect(await f.room.resume(input)).toEqual(receipt);
    await expect(
      f.room.resume({ ...input, response: { kind: 'approval', approved: false } }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      f.room.resume({
        ...input,
        responseId: 'another',
        expectedRevision: f.room.snapshot().revision,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.room.resume({ ...input, requestId: 'another' })).rejects.toMatchObject({
      code: 'conflict',
    });
    await f.room.dispose();
    const restored = await f.load();
    expect(await restored.resume(input)).toEqual(receipt);
    expect(f.first.resumed).not.toHaveBeenCalled();
  });

  it('resumes a ready member while another member still waits', async () => {
    const f = setup(false, true);
    expect(await f.room.run()).toMatchObject({
      status: 'waiting',
      requests: [{ id: 'first-request' }, { id: 'second-request' }],
    });
    await f.approve(f.room);
    expect(await f.room.run()).toMatchObject({
      status: 'waiting',
      requests: [{ id: 'second-request' }],
    });
    expect(f.first.resumed).toHaveBeenCalledOnce();
    expect(f.second.resumed).not.toHaveBeenCalled();
    expect(f.room.snapshot().messages).toEqual([]);
    await f.approve(f.room, 'second-request', 'approval-2');
    await f.room.run();
    expect(f.first.resumed).toHaveBeenCalledOnce();
    expect(f.second.resumed).toHaveBeenCalledOnce();
    expect(f.room.snapshot().messages.map((message) => message.participantId)).toEqual([
      'first',
      'second',
    ]);
  });

  it.each(['submitInput', 'resume'] as const)(
    'shares one input receipt across %s and its crossed redelivery',
    async (method) => {
      const f = setup(true);
      await f.room.run();
      const input = {
        participantId: 'person',
        inputId: 'input-1',
        replyToRequestId: 'first-request',
        content: 'private until commit',
        expectedRevision: f.room.snapshot().revision,
      };
      const response = {
        requestId: input.replyToRequestId,
        responseId: input.inputId,
        expectedRevision: input.expectedRevision,
        response: { kind: 'input' as const, content: input.content },
      };
      if (method === 'submitInput') await f.room.submitInput(input);
      else await f.room.resume(response);
      const accepted = f.room.snapshot().revision;
      await f.room.submitInput(input);
      await f.room.resume(response);
      expect(f.room.snapshot().revision).toBe(accepted);
      expect(f.room.snapshot().messages).toEqual([]);
      expect(f.first.resumed).not.toHaveBeenCalled();
      await f.room.dispose();
      const loaded = await f.load();
      await loaded.run();
      expect(f.first.resumed.mock.calls[0][1][0].response).toEqual(response.response);
      expect(loaded.snapshot().messages.map((message) => message.participantId)).toEqual([
        'person',
        'first',
        'second',
      ]);
      expect(f.select.mock.calls.filter(([context]) => context.turns.length === 0)).toHaveLength(1);
    },
  );

  it('refuses wrong response kinds and unrelated input without consuming a member request', async () => {
    const f = setup();
    await f.room.run();
    const before = f.room.snapshot();
    await expect(
      f.room.resume({
        requestId: 'first-request',
        responseId: 'bad',
        expectedRevision: before.revision,
        response: { kind: 'input', content: 'not approval' },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      f.room.submitInput({
        participantId: 'person',
        inputId: 'unrelated',
        content: 'new context',
        expectedRevision: before.revision,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(f.room.snapshot()).toEqual(before);
  });
});
