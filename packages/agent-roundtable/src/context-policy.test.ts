import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  increments,
  loadRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ContextAssembly,
  type ContextAssemblyInput,
  type ContextPolicy,
  type ParticipantTurn,
  type RoundtableRegistry,
  type SharedMessage,
} from './index';
import { assembleContext } from './context-policy';
import type { ConversationState } from './conversation-state';

const reference = { id: 'host/window', version: '1' };

/** Three agents under round robin say a1, b1, q1, a2, b2, q2: `q` sees two new messages per turn. */
function world() {
  const turns: Record<string, ParticipantTurn[]> = { a: [], b: [], q: [] };
  const opened = vi.fn();
  const participants = ['a', 'b', 'q'].map((id): AgentParticipant => ({
    kind: 'agent',
    id,
    runtime: { id: `host/${id}`, version: '1' },
    factory: {
      checkpointVersions: ['1'],
      openSession: async ({ checkpoint }) => {
        opened(id);
        let count = checkpoint ? Number(checkpoint.data) : 0;
        return {
          session: {
            runTurn: async (turn) => {
              turns[id].push(structuredClone(turn));
              return { kind: 'speak', content: `${id}${++count}` };
            },
            checkpoint: async () => ({ version: '1', data: count }),
          },
          release: async () => {},
        };
      },
    },
  }));
  const registry = (policy?: ContextPolicy): RoundtableRegistry => ({
    resolveParticipant: vi.fn((runtime) => ({
      reference: runtime,
      factory: participants.find((p) => p.runtime.id === runtime.id)!.factory,
    })),
    ...(policy ? { resolveContextPolicy: vi.fn(() => policy) } : {}),
  });
  return { turns, opened, participants, registry };
}

function policy(
  assemble: (input: ContextAssemblyInput) => ContextAssembly,
  overrides: Partial<ContextPolicy> = {},
): ContextPolicy {
  return { reference, modelCalls: 'none', assemble, ...overrides };
}

/** A policy that shapes only what `q` is offered; everyone else keeps the default view. */
function forQ(shape: (input: ContextAssemblyInput) => ContextAssembly): ContextPolicy {
  return policy((input) =>
    input.recipient.id === 'q' ? shape(input) : increments().assemble(input),
  );
}

const contents = (messages: readonly SharedMessage[]) => messages.map((m) => m.content);

async function runAndDispose(room: ReturnType<typeof createRoundtable>) {
  const result = await room.run();
  await room.dispose();
  return result;
}

function stored(state: unknown) {
  return state as ConversationState;
}

describe('the default context policy', () => {
  it('keeps every undelivered foreign message and adds no summary or consumed list', async () => {
    const implicit = world();
    const explicit = world();
    const implicitRoom = createRoundtable({
      conversationId: 'implicit',
      participants: implicit.participants,
      limits: { maxTurnsPerRun: 6 },
    });
    const explicitRoom = createRoundtable({
      conversationId: 'explicit',
      participants: explicit.participants,
      contextPolicy: increments(),
      limits: { maxTurnsPerRun: 6 },
    });
    await runAndDispose(implicitRoom);
    await runAndDispose(explicitRoom);
    expect(contents(implicitRoom.snapshot().messages)).toEqual([
      'a1',
      'b1',
      'q1',
      'a2',
      'b2',
      'q2',
    ]);
    for (const run of [implicit, explicit])
      expect(run.turns.q.map((t) => contents(t.context.messages))).toEqual([
        ['a1', 'b1'],
        ['a2', 'b2'],
      ]);
    for (const turn of Object.values(explicit.turns).flat())
      expect(Object.keys(turn.context).sort()).toEqual(['baseRevision', 'messages']);
  });

  it('is saved under its own reference and cannot be replaced by another policy using it', async () => {
    const store = new MemoryConversationStore();
    const f = world();
    const room = createRoundtable({
      conversationId: 'default-reference',
      store,
      participants: f.participants,
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    expect(stored((await store.load('default-reference'))!.state).definition.contextPolicy).toEqual(
      {
        id: 'roundtable/increments',
        version: '1',
      },
    );
    const builtIn = increments();
    for (const imposter of [
      policy(() => ({ messages: [], consumed: [] }), { reference: builtIn.reference }),
      { ...builtIn },
    ])
      expect(() =>
        createRoundtable({
          conversationId: 'imposter',
          participants: f.participants,
          contextPolicy: imposter,
          limits: { maxTurnsPerRun: 1 },
        }),
      ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });
});

describe('a host context policy', () => {
  it('receives the recipient, its undelivered foreign messages in order, and the purpose', async () => {
    const f = world();
    const assemble = vi.fn((input: ContextAssemblyInput) => increments().assemble(input));
    const room = createRoundtable({
      conversationId: 'input',
      purpose: 'Plan the launch',
      participants: f.participants,
      contextPolicy: policy(assemble),
      limits: { maxTurnsPerRun: 6 },
    });
    await runAndDispose(room);
    const seen = assemble.mock.calls.map(([input]) => [
      input.recipient,
      contents(input.undelivered),
      input.purpose,
    ]);
    expect(seen).toEqual([
      [{ kind: 'participant', id: 'a' }, [], 'Plan the launch'],
      [{ kind: 'participant', id: 'b' }, ['a1'], 'Plan the launch'],
      [{ kind: 'participant', id: 'q' }, ['a1', 'b1'], 'Plan the launch'],
      [{ kind: 'participant', id: 'a' }, ['b1', 'q1'], 'Plan the launch'],
      [{ kind: 'participant', id: 'b' }, ['q1', 'a2'], 'Plan the launch'],
      [{ kind: 'participant', id: 'q' }, ['a2', 'b2'], 'Plan the launch'],
    ]);
  });

  it('delivers a deferred message on a later turn, and the cursor records only what was offered', async () => {
    const f = world();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'deferred',
      store,
      participants: f.participants,
      contextPolicy: forQ(({ undelivered }) => ({
        messages: undelivered.slice(0, 1),
        consumed: [],
      })),
      limits: { maxTurnsPerRun: 6 },
    });
    await runAndDispose(room);
    // q is offered the oldest message each time: b1 was deferred from its first turn to its second.
    expect(f.turns.q.map((t) => contents(t.context.messages))).toEqual([['a1'], ['b1']]);
    const messages = room.snapshot().messages;
    const id = (content: string) => messages.find((m) => m.content === content)!.id;
    const cursor = stored((await store.load('deferred'))!.state).participants.find(
      (p) => p.id === 'q',
    )!.delivered;
    expect(cursor).toEqual([id('a1'), id('b1')]);
  });

  it('never delivers a summarized message again, and the cursor records what it consumed', async () => {
    const f = world();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'summarized',
      store,
      participants: f.participants,
      contextPolicy: forQ(({ undelivered }) => ({
        messages: undelivered.slice(-1),
        summary: `earlier: ${contents(undelivered.slice(0, -1)).join(', ')}`,
        consumed: undelivered.slice(0, -1).map((m) => m.id),
      })),
      limits: { maxTurnsPerRun: 6 },
    });
    await runAndDispose(room);
    expect(f.turns.q.map((t) => [contents(t.context.messages), t.context.summary])).toEqual([
      [['b1'], 'earlier: a1'],
      [['b2'], 'earlier: a2'],
    ]);
    const messages = room.snapshot().messages;
    const id = (content: string) => messages.find((m) => m.content === content)!.id;
    expect(f.turns.q[0].context.consumed).toEqual([id('a1')]);
    const cursor = stored((await store.load('summarized'))!.state).participants.find(
      (p) => p.id === 'q',
    )!.delivered;
    expect(cursor).toEqual([id('b1'), id('a1'), id('b2'), id('a2')]);
    expect(contents(f.turns.q[1].context.messages)).not.toContain('a1');
  });

  it('may consume messages without offering or summarizing them, and may summarize nothing', async () => {
    const f = world();
    const room = createRoundtable({
      conversationId: 'dropped',
      participants: f.participants,
      contextPolicy: forQ(({ undelivered }) => ({
        messages: [],
        consumed: undelivered.map((m) => m.id),
      })),
      limits: { maxTurnsPerRun: 6 },
    });
    await runAndDispose(room);
    expect(f.turns.q.map((t) => [t.context.messages, t.context.summary])).toEqual([
      [[], undefined],
      [[], undefined],
    ]);
    expect(f.turns.q[1].context.consumed).toHaveLength(2);
    const summaryOnly = world();
    const rolling = createRoundtable({
      conversationId: 'rolling',
      participants: summaryOnly.participants,
      contextPolicy: forQ(({ undelivered }) => ({
        messages: undelivered,
        summary: 'so far',
        consumed: [],
      })),
      limits: { maxTurnsPerRun: 3 },
    });
    await runAndDispose(rolling);
    expect(summaryOnly.turns.q[0].context.summary).toBe('so far');
    expect(summaryOnly.turns.q[0].context).not.toHaveProperty('consumed');
  });

  it('is admitted only when it declares no model calls', () => {
    const f = world();
    const make = (contextPolicy: ContextPolicy) =>
      createRoundtable({
        conversationId: 'calls',
        participants: f.participants,
        contextPolicy,
        limits: { maxTurnsPerRun: 1 },
      });
    for (const declared of ['metered', 'enforced', 'free'])
      expect(() =>
        make(policy(() => ({ messages: [], consumed: [] }), { modelCalls: declared as never })),
      ).toThrow(
        expect.objectContaining({
          code: 'invalid-config',
          message: expect.stringMatching(/no model calls/),
        }),
      );
    // An undeclared policy cannot await anything, so it is admitted like an explicit "none".
    const undeclared = policy((input) => increments().assemble(input));
    delete undeclared.modelCalls;
    expect(() => make(undeclared)).not.toThrow();
  });

  it.each([
    ['an empty id', { reference: { id: '', version: '1' } }],
    ['no version', { reference: { id: 'host/x' } }],
    ['no assemble function', { assemble: undefined }],
  ])('is refused at construction with %s', (_label, broken) => {
    const f = world();
    expect(() =>
      createRoundtable({
        conversationId: 'broken',
        participants: f.participants,
        contextPolicy: { ...policy(() => ({ messages: [], consumed: [] })), ...broken } as never,
        limits: { maxTurnsPerRun: 1 },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });
});

describe('a host context policy that returns something invalid', () => {
  const big = 'x'.repeat(32_769);
  /** The first view for `q` is valid; the second is wrong, using what the policy saw earlier. */
  const cases: [
    string,
    RegExp,
    (second: ContextAssemblyInput, earlier: SharedMessage[]) => unknown,
  ][] = [
    [
      'a fabricated message',
      /not undelivered/,
      () => ({
        messages: [
          {
            id: 'forged',
            participantId: 'a',
            content: 'x',
            revision: 1,
            turnId: 't',
            groupId: 'g',
          },
        ],
        consumed: [],
      }),
    ],
    [
      'an altered copy of a real message',
      /not undelivered/,
      ({ undelivered }) => ({
        messages: [{ ...undelivered[0], content: 'rewritten' }],
        consumed: [],
      }),
    ],
    [
      'a message that was already delivered',
      /not undelivered/,
      (_input, earlier) => ({ messages: [earlier[0]], consumed: [] }),
    ],
    [
      'a message the recipient wrote',
      /not undelivered/,
      (_input, earlier) => ({
        messages: [earlier.find((m) => m.participantId === 'q')!],
        consumed: [],
      }),
    ],
    [
      'a message offered twice',
      /twice/,
      ({ undelivered }) => ({ messages: [undelivered[0], undelivered[0]], consumed: [] }),
    ],
    [
      'an unknown consumed id',
      /consumed a message that is not undelivered/,
      () => ({ messages: [], consumed: ['nobody'] }),
    ],
    [
      'a consumed id that was already delivered',
      /consumed a message that is not undelivered/,
      (_input, earlier) => ({ messages: [], consumed: [earlier[0].id] }),
    ],
    [
      'a consumed id that is also offered',
      /already accounted/,
      ({ undelivered }) => ({ messages: [undelivered[0]], consumed: [undelivered[0].id] }),
    ],
    [
      'a duplicate consumed id',
      /already accounted/,
      ({ undelivered }) => ({ messages: [], consumed: [undelivered[0].id, undelivered[0].id] }),
    ],
    ['an empty summary', /summary/, () => ({ messages: [], summary: '', consumed: [] })],
    ['an oversized summary', /summary/, () => ({ messages: [], summary: big, consumed: [] })],
    [
      'a summary shaped like a message',
      /summary/,
      () => ({
        messages: [],
        summary: { id: 'm', participantId: 'a', content: 'x' },
        consumed: [],
      }),
    ],
    ['no consumed list', /needs messages and consumed/, () => ({ messages: [] })],
    ['no result at all', /no result/, () => undefined],
    ['a promise instead of a result', /needs messages and consumed/, () => Promise.resolve({})],
    [
      'a thrown error',
      /Context policy failed for q: policy exploded/,
      () => {
        throw new Error('policy exploded');
      },
    ],
  ];

  it.each(cases)(
    'fails the conversation before any turn starts: %s',
    async (_label, expected, bad) => {
      const f = world();
      const store = new MemoryConversationStore();
      const earlier: SharedMessage[] = [];
      let calls = 0;
      const room = createRoundtable({
        conversationId: 'invalid',
        store,
        participants: f.participants,
        contextPolicy: policy((input) => {
          earlier.push(...input.undelivered);
          if (input.recipient.id !== 'q' || ++calls === 1) return increments().assemble(input);
          return bad(input, earlier) as ContextAssembly;
        }),
        limits: { maxTurnsPerRun: 6 },
      });
      const result = await room.run();
      expect(result).toMatchObject({ status: 'failed', message: expect.stringMatching(expected) });
      // Nothing from the refused group was stored, and no member of it ran.
      expect(contents(room.snapshot().messages)).toEqual(['a1', 'b1', 'q1', 'a2', 'b2']);
      expect(f.turns.q).toHaveLength(1);
      const state = stored((await store.load('invalid'))!.state);
      expect(state.phase.kind).not.toBe('group');
      expect(state.terminal).toMatchObject({ status: 'failed' });
      expect(await room.run()).toEqual(result);
      await room.dispose();
    },
  );

  it('throws a typed error from the assembly step', () => {
    const messages: SharedMessage[] = [
      { id: 'm1', participantId: 'a', content: 'one', revision: 1, turnId: 't', groupId: 'g' },
    ];
    const assemble = (result: () => unknown) =>
      assembleContext(policy(result as never), {
        participantId: 'q',
        transcript: messages,
        delivered: [],
        baseRevision: 1,
      });
    for (const result of [
      () => {
        throw new Error('boom');
      },
      () => ({ messages: [{ ...messages[0], content: 'rewritten' }], consumed: [] }),
      () => ({ messages: [], summary: '', consumed: [] }),
    ])
      expect(() => assemble(result)).toThrow(expect.objectContaining({ code: 'invalid-context' }));
  });

  it('does not let the policy alter the stored transcript through the copy it received', async () => {
    const f = world();
    const room = createRoundtable({
      conversationId: 'mutating',
      participants: f.participants,
      contextPolicy: policy((input) => {
        for (const message of input.undelivered)
          (message as { content: string }).content = 'tampered';
        return { messages: input.undelivered, consumed: [] };
      }),
      limits: { maxTurnsPerRun: 3 },
    });
    expect((await room.run()).status).toBe('failed');
    expect(contents(room.snapshot().messages)).toEqual(['a1']);
    await room.dispose();
  });
});

describe('a host context policy saved with the conversation', () => {
  const summarize = forQ(({ undelivered }) => ({
    messages: undelivered.slice(-1),
    summary: `earlier: ${contents(undelivered.slice(0, -1)).join(', ')}`,
    consumed: undelivered.slice(0, -1).map((m) => m.id),
  }));

  async function saved(conversationId: string, maxTurnsPerRun: number, contextPolicy = summarize) {
    const f = world();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId,
      store,
      participants: f.participants,
      contextPolicy,
      limits: { maxTurnsPerRun },
    });
    await room.run();
    await room.dispose();
    return { f, store };
  }

  it('is stored in the definition and resolved by the registry on load', async () => {
    const { f, store } = await saved('saved', 3);
    expect(stored((await store.load('saved'))!.state).definition.contextPolicy).toEqual(reference);
    const registry = f.registry(summarize);
    const loaded = await loadRoundtable({ conversationId: 'saved', store, registry });
    expect(registry.resolveContextPolicy).toHaveBeenCalledExactlyOnceWith(reference);
    await loaded.run();
    // The loaded conversation keeps applying the resolved policy: q's second turn is summarized too.
    expect(f.turns.q.map((t) => [contents(t.context.messages), t.context.summary])).toEqual([
      [['b1'], 'earlier: a1'],
      [['b2'], 'earlier: a2'],
    ]);
    await loaded.dispose();
    const second = await saved('saved-two', 6);
    const again = await loadRoundtable({
      conversationId: 'saved-two',
      store: second.store,
      registry: second.f.registry(summarize),
    });
    expect(again.snapshot().messages).toHaveLength(6);
    await again.dispose();
  });

  it('is refused on load without a resolver, before any session, registry call or store write', async () => {
    const { f, store } = await saved('no-resolver', 3);
    const opened = f.opened.mock.calls.length;
    const writes = ['create', 'claim', 'renew', 'release', 'commit'].map((method) =>
      vi.spyOn(store, method as 'commit'),
    );
    const registry = f.registry();
    await expect(
      loadRoundtable({ conversationId: 'no-resolver', store, registry }),
    ).rejects.toMatchObject({ code: 'invalid-config', message: /not registered/ });
    expect(registry.resolveParticipant).not.toHaveBeenCalled();
    expect(f.opened.mock.calls.length).toBe(opened);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ['another version', { id: 'host/window', version: '2' }],
    ['another id', { id: 'host/other', version: '1' }],
    ['the built-in policy', increments().reference],
  ])('is refused on load when the registry resolves %s', async (_label, resolved) => {
    const { f, store } = await saved('mismatch', 3);
    const opened = f.opened.mock.calls.length;
    const writes = ['create', 'claim', 'renew', 'release', 'commit'].map((method) =>
      vi.spyOn(store, method as 'commit'),
    );
    const registry = f.registry(policy(summarize.assemble, { reference: resolved }));
    await expect(
      loadRoundtable({ conversationId: 'mismatch', store, registry }),
    ).rejects.toMatchObject({ code: 'invalid-config', message: /explicit migration/ });
    expect(registry.resolveParticipant).not.toHaveBeenCalled();
    expect(f.opened.mock.calls.length).toBe(opened);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it('is refused on load when the resolved policy declares model calls', async () => {
    const { f, store } = await saved('metered', 3);
    const opened = f.opened.mock.calls.length;
    const registry = f.registry({ ...summarize, modelCalls: 'metered' as never });
    await expect(
      loadRoundtable({ conversationId: 'metered', store, registry }),
    ).rejects.toMatchObject({ code: 'invalid-config', message: /no model calls/ });
    expect(f.opened.mock.calls.length).toBe(opened);
  });

  it('is not asked to resolve while interrupted work still has to be reconciled', async () => {
    const f = world();
    const store = new MemoryConversationStore();
    const commit = store.commit.bind(store);
    vi.spyOn(store, 'commit').mockImplementation(async (change) => {
      const state = stored(change.state);
      if (state.phase.kind === 'group' && state.phase.members[0].status === 'settled')
        throw new Error('store disconnected');
      return commit(change);
    });
    const room = createRoundtable({
      conversationId: 'interrupted',
      store,
      participants: f.participants,
      contextPolicy: summarize,
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    const registry = f.registry(summarize);
    await expect(
      loadRoundtable({ conversationId: 'interrupted', store, registry }),
    ).rejects.toMatchObject({ code: 'recovery-required' });
    expect(registry.resolveContextPolicy).not.toHaveBeenCalled();
  });

  it('is not called again for a group that was stored before the load', async () => {
    const f = world();
    const store = new MemoryConversationStore();
    const commit = store.commit.bind(store);
    let refused = false;
    vi.spyOn(store, 'commit').mockImplementation(async (change) => {
      const state = stored(change.state);
      const phase = state.phase;
      if (
        !refused &&
        phase.kind === 'group' &&
        phase.members[0].participantId === 'q' &&
        phase.members[0].status === 'running'
      ) {
        refused = true;
        throw new Error('store disconnected');
      }
      return commit(change);
    });
    const assemble = vi.fn(summarize.assemble);
    const counted = policy(assemble);
    const room = createRoundtable({
      conversationId: 'stored-group',
      store,
      participants: f.participants,
      contextPolicy: counted,
      limits: { maxTurnsPerRun: 3 },
    });
    expect(await room.run()).toMatchObject({ status: 'failed' });
    await room.dispose();
    const forQBefore = assemble.mock.calls.filter(([input]) => input.recipient.id === 'q');
    expect(forQBefore).toHaveLength(1);
    expect(f.turns.q).toHaveLength(0);
    const loaded = await loadRoundtable({
      conversationId: 'stored-group',
      store,
      registry: f.registry(counted),
    });
    await loaded.run();
    // The stored view is what q runs on; the policy was asked only for the groups started after.
    expect(assemble.mock.calls.filter(([input]) => input.recipient.id === 'q')).toHaveLength(1);
    expect(f.turns.q).toHaveLength(1);
    expect(f.turns.q[0].context.summary).toBe('earlier: a1');
    expect(contents(f.turns.q[0].context.messages)).toEqual(['b1']);
    await loaded.dispose();
  });
});

describe('a stored turn context is validated on load', () => {
  const summarize = forQ(({ undelivered }) => ({
    messages: undelivered.slice(-1),
    summary: `earlier: ${contents(undelivered.slice(0, -1)).join(', ')}`,
    consumed: undelivered.slice(0, -1).map((m) => m.id),
  }));

  /** Stops the store when q's second group starts, so its summarized view is what was saved. */
  async function storedGroup() {
    const f = world();
    const store = new MemoryConversationStore();
    const commit = store.commit.bind(store);
    let refused = false;
    vi.spyOn(store, 'commit').mockImplementation(async (change) => {
      const state = stored(change.state);
      const { phase } = state;
      if (
        !refused &&
        phase.kind === 'group' &&
        phase.members[0].participantId === 'q' &&
        phase.members[0].status === 'running' &&
        state.snapshot.turns.some((turn) => turn.participantId === 'q')
      ) {
        refused = true;
        throw new Error('store disconnected');
      }
      return commit(change);
    });
    const room = createRoundtable({
      conversationId: 'stored',
      store,
      participants: f.participants,
      contextPolicy: summarize,
      limits: { maxTurnsPerRun: 6 },
    });
    await room.run();
    await room.dispose();
    return { f, store };
  }

  function view(state: ConversationState) {
    if (state.phase.kind !== 'group') throw new Error('Expected a stored group');
    const message = (content: string) =>
      state.snapshot.messages.find((m) => m.content === content)!;
    return { phase: state.phase, context: state.phase.members[0].turn.context, message };
  }

  it('accepts a context that carries a summary and consumed ids, and runs on it unchanged', async () => {
    const { f, store } = await storedGroup();
    const { context, message } = view(stored((await store.load('stored'))!.state));
    expect(context).toMatchObject({ summary: 'earlier: a2', consumed: [message('a2').id] });
    const loaded = await loadRoundtable({
      conversationId: 'stored',
      store,
      registry: f.registry(summarize),
    });
    await loaded.run();
    expect(f.turns.q[1].context).toEqual(context);
    await loaded.dispose();
  });

  const corruptions: [string, (v: ReturnType<typeof view>) => void][] = [
    ['an empty summary', (v) => ((v.context as { summary: string }).summary = '')],
    [
      'an oversized summary',
      (v) => ((v.context as { summary: string }).summary = 'x'.repeat(32_769)),
    ],
    [
      'a summary shaped like a message',
      (v) =>
        ((v.context as { summary: unknown }).summary = { ...v.message('b2'), content: 'forged' }),
    ],
    ['a numeric summary', (v) => ((v.context as { summary: unknown }).summary = 5)],
    ['an empty consumed list', (v) => ((v.context as { consumed: unknown }).consumed = [])],
    [
      'a consumed id that is not a list',
      (v) => ((v.context as { consumed: unknown }).consumed = 'a2'),
    ],
    ['an unknown consumed id', (v) => ((v.context as { consumed: unknown }).consumed = ['nobody'])],
    [
      'a consumed id that was already delivered',
      (v) => ((v.context as { consumed: unknown }).consumed = [v.message('a1').id]),
    ],
    [
      'a consumed id the member wrote',
      (v) => ((v.context as { consumed: unknown }).consumed = [v.message('q1').id]),
    ],
    [
      'a consumed id that is also offered',
      (v) => ((v.context as { consumed: unknown }).consumed = [v.message('b2').id]),
    ],
    [
      'a repeated consumed id',
      (v) =>
        ((v.context as { consumed: unknown }).consumed = [v.message('a2').id, v.message('a2').id]),
    ],
    [
      'a consumed message above the base revision',
      (v) => {
        const base = v.message('q1').revision;
        Object.assign(v.phase, { baseRevision: base });
        Object.assign(v.context, { baseRevision: base, messages: [] });
      },
    ],
    [
      'an offered message that was already delivered',
      (v) => ((v.context as { messages: unknown }).messages = [v.message('a1')]),
    ],
    [
      'an offered message the member wrote',
      (v) => ((v.context as { messages: unknown }).messages = [v.message('q1')]),
    ],
    [
      'an offered message that is not in the transcript',
      (v) =>
        ((v.context as { messages: unknown }).messages = [{ ...v.message('b2'), id: 'forged' }]),
    ],
    [
      'an offered message with altered content',
      (v) => (v.context.messages[0].content = 'rewritten'),
    ],
  ];

  it.each(corruptions)('rejects %s before resolving anything', async (_label, corrupt) => {
    const { f, store } = await storedGroup();
    const envelope = (await store.load('stored'))!;
    corrupt(view(stored(envelope.state)));
    vi.spyOn(store, 'load').mockResolvedValue(envelope);
    const registry = f.registry(summarize);
    await expect(
      loadRoundtable({ conversationId: 'stored', store, registry }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect(registry.resolveContextPolicy).not.toHaveBeenCalled();
    expect(registry.resolveParticipant).not.toHaveBeenCalled();
  });
});
