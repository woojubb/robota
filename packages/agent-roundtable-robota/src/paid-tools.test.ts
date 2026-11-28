import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type { TExecutionJournalRecord, TUniversalMessage } from '@robota-sdk/agent-core';
import {
  createRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type JsonValue,
  type ParticipantExecutionOptions,
  type ParticipantResponse,
  type ParticipantTurn,
  type PricePolicy,
  type Roundtable,
  type TurnServices,
  type UsageRecord,
} from '@robota-sdk/agent-roundtable';
import { normalizeEnforcement, type RuntimeEnforcement } from './enforcement';
import { meterJournal } from './metering-journal';
import { sessionParticipant, type SessionHostOptions } from './session-participant';

afterEach(() => {
  clearRegisteredToolProfiles();
});

const exact = { providerAttempts: 1, requestOverheadTokens: 0 };

function turn(): ParticipantTurn {
  return {
    conversationId: 'c',
    participantId: 'p',
    turnId: 't1',
    attemptId: 'a1',
    groupId: 'g1',
    context: { baseRevision: 0, messages: [] },
  };
}

function toolEffectStart(toolName: string, actionId = 'act-1'): TExecutionJournalRecord {
  return {
    recordId: `start-${actionId}`,
    executionId: 'exec-1',
    kind: 'tool-effect-start',
    actionId,
    parentCallId: 'call-1',
    toolCallId: `tc-${actionId}`,
    toolName,
    parameters: {},
  };
}

function toolResult(toolName: string, success = true, actionId = 'act-1'): TExecutionJournalRecord {
  return {
    recordId: `result-${actionId}`,
    executionId: 'exec-1',
    kind: 'tool-result',
    actionId,
    parentCallId: 'call-1',
    toolCallId: `tc-${actionId}`,
    toolName,
    result: success
      ? { executionId: `tc-${actionId}`, toolName, success: true, result: 'ok' }
      : { executionId: `tc-${actionId}`, toolName, success: false, error: 'boom' },
  } as TExecutionJournalRecord;
}

function modelRequest(callId: string): TExecutionJournalRecord {
  return {
    recordId: `req-${callId}`,
    executionId: 'exec-1',
    callId,
    providerId: 'anthropic',
    modelId: 'claude',
    kind: 'model-request',
    messages: [] as TUniversalMessage[],
    options: { maxTokens: 10 },
  };
}

/** A participant whose one turn hands its bound services to `body`, against a real ledger. */
function harness(
  body: (services: TurnServices) => Promise<void>,
  roomOptions: { budget?: Parameters<typeof createRoundtable>[0]['budget']; pricing?: PricePolicy },
): { room: Roundtable; failure: () => unknown } {
  let failure: unknown;
  const participant: AgentParticipant = {
    kind: 'agent',
    id: 'p',
    runtime: { id: 'fixture/journal', version: '1' },
    factory: {
      modelCalls: 'enforced',
      openSession: async () => ({
        session: {
          runTurn: async (_turn: ParticipantTurn, options: ParticipantExecutionOptions) => {
            try {
              await body(options.services);
            } catch (error) {
              failure = error;
            }
            return { kind: 'speak', content: 'ok' };
          },
        },
        release: async () => {},
      }),
    },
  };
  const room = createRoundtable({
    conversationId: 'paid',
    store: new MemoryConversationStore(),
    participants: [participant],
    limits: { maxTurnsPerRun: 1 },
    ...roomOptions,
  });
  return { room, failure: () => failure };
}

const perToken: PricePolicy = {
  version: 'per-token',
  cost: (record) => {
    const tokens = record.status === 'settled' ? record.tokens : undefined;
    return { currency: 'USD', minorUnits: String((tokens?.input ?? 0) + (tokens?.output ?? 0)) };
  },
  bound: (call) => ({
    currency: 'USD',
    minorUnits: String(call.bound.inputTokens + call.bound.maxOutputTokens),
  }),
};

function toolRecords(room: Roundtable): UsageRecord[] {
  return room.snapshot().usage.filter((record) => record.kind === 'tool-effect');
}

describe('normalizeEnforcement: paid tools', () => {
  const base: RuntimeEnforcement = exact;

  it('keeps each paid tool with its token bound, zero included', () => {
    const normalized = normalizeEnforcement({
      ...base,
      freeTools: ['read'],
      paidTools: { search: { tokens: 0 }, summarize: { tokens: 500 } },
    });
    expect([...normalized.paidTools]).toEqual([
      ['search', 0],
      ['summarize', 500],
    ]);
    expect(normalizeEnforcement(base).paidTools.size).toBe(0);
  });

  it.each([
    ['a negative bound', { a: { tokens: -1 } }],
    ['a fractional bound', { a: { tokens: 1.5 } }],
    ['an unsafe bound', { a: { tokens: 2 ** 60 } }],
    ['a NaN bound', { a: { tokens: Number.NaN } }],
    ['a missing bound', { a: {} }],
    ['a non-number bound', { a: { tokens: '5' } }],
    ['a null declaration', { a: null }],
    ['an empty tool name', { '': { tokens: 1 } }],
    ['a tool also declared free', { read: { tokens: 1 } }],
    ['a list instead of a record', [{ tokens: 1 }]],
    ['null', null],
    ['a string', 'a'],
  ])('refuses %s with invalid-config', (_label, paidTools) => {
    expect(() =>
      normalizeEnforcement({
        ...base,
        freeTools: ['read'],
        paidTools: paidTools as unknown as RuntimeEnforcement['paidTools'],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });

  it('refuses at participant creation, before any runtime is opened', () => {
    const unused = () => {
      throw new Error('not used');
    };
    expect(() =>
      sessionParticipant({
        id: 'p',
        runtime: { id: 'f', version: '1' },
        enforcement: { ...base, paidTools: { a: { tokens: -1 } } },
        createSessionOptions: unused,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });
});

/** The call id the one admitted tool effect took: fresh, never the journal's action id. */
function effectCallId(services: TurnServices): string {
  const [call] = vi.mocked(services.admitToolEffect).mock.calls;
  const callId = call![0].callId;
  expect(callId).toMatch(/^tool-effect:/);
  expect(callId).not.toContain('act-1');
  return callId;
}

describe('meterJournal: paid tool effects', () => {
  function fakeServices() {
    const order: string[] = [];
    const services: TurnServices = {
      admitModelCall: vi.fn(async () => {}),
      recordUsage: vi.fn(async (report) => {
        order.push(`record:${report.callId}`);
      }),
      admitToolEffect: vi.fn(async (effect) => {
        order.push(`admit:${effect.callId}`);
      }),
    };
    const appended: TExecutionJournalRecord[] = [];
    const inner = {
      append: vi.fn(async (record: TExecutionJournalRecord) => {
        order.push(`append:${record.kind}`);
        appended.push(record);
      }),
    };
    return { services, inner, order, appended };
  }
  const enforcement: RuntimeEnforcement = {
    ...exact,
    freeTools: ['free'],
    paidTools: { money: { tokens: 0 }, model: { tokens: 40 } },
  };

  it('admits a paid effect with its id and bound before the start record reaches the journal', async () => {
    const f = fakeServices();
    await meterJournal(f.inner, f.services, enforcement).append(toolEffectStart('model'));
    const callId = effectCallId(f.services);
    expect(f.order).toEqual([`admit:${callId}`, 'append:tool-effect-start']);
    expect(f.services.admitToolEffect).toHaveBeenCalledWith({
      callId,
      toolName: 'model',
      tokens: 40,
    });
    expect(f.services.admitModelCall).not.toHaveBeenCalled();
  });

  it('never starts an effect whose admission is rejected', async () => {
    const f = fakeServices();
    vi.mocked(f.services.admitToolEffect).mockRejectedValue(
      Object.assign(new Error('Token budget would be exceeded'), { code: 'budget-limit' }),
    );
    const metered = meterJournal(f.inner, f.services, enforcement);
    await expect(metered.append(toolEffectStart('model'))).rejects.toMatchObject({
      code: 'budget-limit',
    });
    expect(f.inner.append).not.toHaveBeenCalled();
    // The result of an effect that never started charges nothing either.
    await metered.append(toolResult('model', false));
    expect(f.services.recordUsage).not.toHaveBeenCalled();
  });

  it('charges nothing for a result with no start record, as a denied approval produces', async () => {
    const f = fakeServices();
    await meterJournal(f.inner, f.services, enforcement).append(toolResult('money', false));
    expect(f.services.admitToolEffect).not.toHaveBeenCalled();
    expect(f.services.recordUsage).not.toHaveBeenCalled();
    expect(f.appended).toHaveLength(1);
  });

  it('leaves a declared free tool unadmitted and unreported', async () => {
    const f = fakeServices();
    const metered = meterJournal(f.inner, f.services, enforcement);
    await metered.append(toolEffectStart('free'));
    await metered.append(toolResult('free'));
    expect(f.services.admitToolEffect).not.toHaveBeenCalled();
    expect(f.services.recordUsage).not.toHaveBeenCalled();
  });

  it('still refuses an undeclared tool effect and appends nothing', async () => {
    const f = fakeServices();
    await expect(
      meterJournal(f.inner, f.services, enforcement).append(toolEffectStart('mystery')),
    ).rejects.toMatchObject({
      code: 'unbounded-call',
      message: expect.stringContaining('mystery'),
    });
    expect(f.inner.append).not.toHaveBeenCalled();
    expect(f.services.admitToolEffect).not.toHaveBeenCalled();
  });

  it('settles a money-only effect as reported with zero tokens, whatever the tool concluded', async () => {
    for (const success of [true, false]) {
      const f = fakeServices();
      const metered = meterJournal(f.inner, f.services, enforcement);
      await metered.append(toolEffectStart('money'));
      await metered.append(toolResult('money', success));
      expect(f.services.recordUsage).toHaveBeenCalledWith({
        callId: effectCallId(f.services),
        outcome: 'completed',
        provenance: 'reported',
        tokens: { input: 0, output: 0 },
        final: true,
      });
    }
  });

  it('settles a model-backed effect as unknown and not final', async () => {
    const f = fakeServices();
    const metered = meterJournal(f.inner, f.services, enforcement);
    await metered.append(toolEffectStart('model'));
    await metered.append(toolResult('model'));
    expect(f.services.recordUsage).toHaveBeenCalledWith({
      callId: effectCallId(f.services),
      outcome: 'completed',
      provenance: 'unknown',
      final: false,
    });
  });

  it('keeps tool-effect ids apart from model-call ids and refuses a model call that takes the prefix', async () => {
    const f = fakeServices();
    const metered = meterJournal(f.inner, f.services, enforcement);
    await metered.append(modelRequest('call-1'));
    await metered.append(toolEffectStart('money', 'call-1'));
    expect(f.services.admitModelCall).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'call-1' }),
    );
    expect(f.services.admitToolEffect).toHaveBeenCalledWith(
      expect.objectContaining({ callId: expect.stringMatching(/^tool-effect:/) }),
    );
    await expect(metered.append(modelRequest('tool-effect:x'))).rejects.toMatchObject({
      code: 'unbounded-call',
    });
  });

  it('admits nothing when no enforcement is declared', async () => {
    const f = fakeServices();
    await meterJournal(f.inner, f.services).append(toolEffectStart('anything'));
    expect(f.services.admitToolEffect).not.toHaveBeenCalled();
  });
});

describe('paid tool effects against a real ledger', () => {
  const journalFor = (services: TurnServices, tokens: number) =>
    meterJournal({ append: async () => {} }, services, {
      ...exact,
      paidTools: { paid: { tokens } },
    });
  const settle = (tokens: number) => async (services: TurnServices) => {
    const metered = journalFor(services, tokens);
    await metered.append(modelRequest('call-1'));
    await metered.append(toolEffectStart('paid'));
    await metered.append(toolResult('paid'));
  };

  it('records a money-only effect as a settled tool effect with zero tokens', async () => {
    const { room, failure } = harness(settle(0), { budget: { tokens: 100_000 } });
    await room.run();
    expect(failure()).toBeUndefined();
    const [record] = toolRecords(room);
    expect(record).toMatchObject({
      callId: expect.stringMatching(/^tool-effect:/),
      kind: 'tool-effect',
      status: 'settled',
      provenance: 'reported',
      tokens: { input: 0, output: 0 },
    });
    // The model call and the tool effect are two records under distinct ids.
    expect(room.snapshot().usage.map((r) => r.callId)).toEqual(['call-1', record!.callId]);
    await room.dispose();
  });

  it('keeps a model-backed effect at its bound until the host reconciles it', async () => {
    const { room, failure } = harness(settle(40), { budget: { tokens: 100_000 } });
    await room.run();
    expect(failure()).toBeUndefined();
    const [record] = toolRecords(room);
    expect(record).toMatchObject({
      status: 'settled',
      provenance: 'unknown',
      final: false,
      reconciled: null,
      reservation: { tokens: 40 },
    });
    await room.reconcileUsage({ callId: record!.callId, tokens: 7 });
    expect(toolRecords(room)[0]!.reconciled).toMatchObject({ tokens: 7 });
    await room.dispose();
  });

  it('admits a repeated append through one journal once, and a fresh journal under a fresh id', async () => {
    for (const tokens of [0, 40]) {
      const { room, failure } = harness(
        async (services) => {
          const first = journalFor(services, tokens);
          await first.append(modelRequest('call-1'));
          await first.append(toolEffectStart('paid'));
          await first.append(toolEffectStart('paid'));
          await first.append(toolResult('paid'));
          await first.append(toolResult('paid'));
          // A resumed attempt writes the same action again through a fresh journal: a new admission,
          // never the old one's id, which recovery may have refunded.
          const retry = journalFor(services, tokens);
          await retry.append(toolEffectStart('paid'));
          await retry.append(toolResult('paid'));
        },
        { budget: { tokens: 100_000 } },
      );
      await room.run();
      expect(failure()).toBeUndefined();
      const records = toolRecords(room);
      expect(records).toHaveLength(2);
      expect(new Set(records.map((record) => record.callId)).size).toBe(2);
      await room.dispose();
    }
  });

  it('refuses a paid effect that would exceed the budget, before the effect starts', async () => {
    const started: string[] = [];
    const { room, failure } = harness(
      async (services) => {
        const metered = meterJournal(
          {
            append: async (record) => {
              started.push(record.kind);
            },
          },
          services,
          { ...exact, paidTools: { paid: { tokens: 1_000 } } },
        );
        await metered.append(toolEffectStart('paid'));
      },
      { budget: { tokens: 999 } },
    );
    const result = await room.run();
    expect(failure()).toMatchObject({ code: 'budget-limit' });
    expect(started).toEqual([]);
    expect(toolRecords(room)).toHaveLength(0);
    expect(result).toMatchObject({ status: 'limited', reason: 'budget' });
    await room.dispose();
  });

  it('prices a paid effect through the policy as a tool effect, and refuses one it cannot price', async () => {
    const kinds: string[] = [];
    const priced: PricePolicy = {
      ...perToken,
      bound: (call) => {
        kinds.push(call.kind);
        return perToken.bound!(call);
      },
    };
    const first = harness(settle(40), {
      budget: { cost: { currency: 'USD', minorUnits: '1000' } },
      pricing: priced,
    });
    await first.room.run();
    expect(first.failure()).toBeUndefined();
    expect(kinds).toContain('tool-effect');
    expect(toolRecords(first.room)[0]!.reservation).toMatchObject({
      tokens: 40,
      cost: { currency: 'USD', minorUnits: '40' },
    });
    await first.room.dispose();

    const started: string[] = [];
    const unpriceable: PricePolicy = {
      ...perToken,
      bound: (call) => (call.kind === 'tool-effect' ? null : perToken.bound!(call)),
    };
    const second = harness(
      async (services) => {
        const metered = meterJournal(
          {
            append: async (record) => {
              started.push(record.kind);
            },
          },
          services,
          { ...exact, paidTools: { paid: { tokens: 40 } } },
        );
        await metered.append(toolEffectStart('paid'));
      },
      { budget: { cost: { currency: 'USD', minorUnits: '1000' } }, pricing: unpriceable },
    );
    await second.room.run();
    expect(second.failure()).toMatchObject({ code: 'invalid-config' });
    expect(started).toEqual([]);
    expect(toolRecords(second.room)).toHaveLength(0);
    await second.room.dispose();
  });
});

describe('a Session with a paid tool', () => {
  function fixture(tokens: number, permissions: 'allow' | 'ask', budgetTokens = 1_000_000) {
    const scripted = createScriptedProvider([
      {
        toolCalls: [{ name: 'act', args: {} }],
        usage: { inputTokens: 20, outputTokens: 5 },
      },
      { text: 'done', usage: { inputTokens: 30, outputTokens: 6 } },
    ]);
    const provider = {
      ...scripted.provider,
      chat: async (
        messages: Parameters<typeof scripted.provider.chat>[0],
        options: Parameters<typeof scripted.provider.chat>[1],
      ) => {
        const reply = await scripted.provider.chat(messages, options);
        return { ...reply, metadata: { ...reply.metadata, usageProvenance: 'complete' } };
      },
    };
    let room: Roundtable | undefined;
    const seenWhenRun: UsageRecord[][] = [];
    const effect = vi.fn(async () => {
      seenWhenRun.push(room!.snapshot().usage.filter((record) => record.kind === 'tool-effect'));
      return 'ok';
    });
    const tool = new FunctionTool(
      { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      effect,
    );
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      enforcement: { ...exact, paidTools: { act: { tokens } } },
      createSessionOptions: async () =>
        ({
          cwd: process.cwd(),
          hookTypeExecutors: [],
          tools: [tool],
          provider,
          systemMessage: 'Fixture host',
          model: 'test-model',
          autoCompactThreshold: false,
          maxOutputTokens: 64,
          permissions:
            permissions === 'allow'
              ? { allow: ['act'], deny: [], ask: [] }
              : { allow: [], deny: [], ask: ['act'] },
        }) satisfies SessionHostOptions,
    });
    room = createRoundtable({
      conversationId: 'session-paid',
      store: new MemoryConversationStore(),
      participants: [participant],
      limits: { maxTurnsPerRun: 1 },
      budget: { tokens: budgetTokens },
    });
    return { room, scripted, effect, seenWhenRun, participant };
  }

  it('admits the effect before it runs and settles it at the tool result', async () => {
    const f = fixture(0, 'allow');
    await f.room.run();
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.seenWhenRun[0]).toHaveLength(1);
    expect(f.seenWhenRun[0]![0]).toMatchObject({ status: 'reserved', kind: 'tool-effect' });
    expect(toolRecords(f.room)[0]).toMatchObject({
      status: 'settled',
      provenance: 'reported',
      tokens: { input: 0, output: 0 },
    });
    const ids = f.room.snapshot().usage.map((record) => record.callId);
    expect(new Set(ids).size).toBe(ids.length);
    await f.room.dispose();
  });

  it('does not run an effect the budget cannot admit, and ends the run limited', async () => {
    const f = fixture(10_000_000, 'allow');
    const result = await f.room.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(f.effect).not.toHaveBeenCalled();
    expect(toolRecords(f.room)).toHaveLength(0);
    await f.room.dispose();
  });

  it('charges nothing when the approval is denied', async () => {
    const f = fixture(40, 'ask');
    const lease = await f.participant.factory.openSession({
      conversationId: 'c',
      participantId: 'p',
    });
    const admitted: string[] = [];
    const services: TurnServices = {
      admitModelCall: async () => {},
      recordUsage: async () => {},
      admitToolEffect: async (effect) => {
        admitted.push(effect.callId);
      },
    };
    const options = (): ParticipantExecutionOptions => ({
      signal: new AbortController().signal,
      onDelta: async () => {},
      services,
    });
    const t = turn();
    const waiting = await lease.session.runTurn(t, options());
    if (waiting.kind !== 'wait') throw new Error('expected wait');
    const request = waiting.requests[0] as unknown as { id: string; reason: string; data: unknown };
    const response: ParticipantResponse = {
      request: {
        id: request.id,
        reason: request.reason,
        kind: 'approval',
        participantId: t.participantId,
        groupId: t.groupId,
        turnId: t.turnId,
        memberId: t.participantId,
        data: request.data as JsonValue,
      },
      responseId: 'reply-1',
      response: { kind: 'approval', approved: false },
    };
    await lease.session.resumeTurn!(t, [response], options());
    expect(f.effect).not.toHaveBeenCalled();
    expect(admitted).toEqual([]);
    await lease.release();
    await f.room.dispose();
  });
});
