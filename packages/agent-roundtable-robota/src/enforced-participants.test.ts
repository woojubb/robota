import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import {
  ConversationAgent,
  FunctionTool,
  clearRegisteredToolProfiles,
} from '@robota-sdk/agent-core';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';
import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  type ModelCallIntent,
  type ParticipantExecutionOptions,
  type ParticipantTurn,
  type RoundtableRegistry,
  type TurnServices,
} from '@robota-sdk/agent-roundtable';
import { runtimeParticipant } from './runtime-participant';
import { runtimeSelector } from './runtime-selector';
import { sessionParticipant, type SessionHostOptions } from './session-participant';
import type { RuntimeEnforcement } from './enforcement';

afterEach(() => {
  clearRegisteredToolProfiles();
});

type Scripted = ReturnType<typeof createScriptedProvider>;

/** A provider whose usage is attested as complete, the way a real adapter marks what it reports. */
function attested(scripted: Scripted, attemptsInside = 1): IAIProvider {
  const inner = scripted.provider;
  return {
    ...inner,
    chat: async (messages, options) => {
      let reply: TUniversalMessage | undefined;
      // A provider client that bills several requests for one call: only the last is reported.
      for (let attempt = 0; attempt < attemptsInside; attempt += 1)
        reply = await inner.chat(messages, options);
      return { ...reply!, metadata: { ...reply!.metadata, usageProvenance: 'complete' } };
    },
  };
}

const exact: RuntimeEnforcement = { providerAttempts: 1, requestOverheadTokens: 0 };

function sessionHost(provider: IAIProvider, extra: Partial<SessionHostOptions> = {}) {
  return {
    cwd: process.cwd(),
    hookTypeExecutors: [],
    tools: [],
    provider,
    systemMessage: 'Fixture host',
    model: 'test-model',
    autoCompactThreshold: false,
    maxOutputTokens: 64,
    ...extra,
  } satisfies SessionHostOptions;
}

function actTool() {
  return new FunctionTool(
    { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
    async () => 'ok',
  );
}

function enforcedSession(
  scripted: Scripted,
  enforcement: RuntimeEnforcement = { ...exact, freeTools: ['act'] },
  attemptsInside = 1,
) {
  return sessionParticipant({
    id: 'p',
    runtime: { id: 'fixture/session', version: '1' },
    enforcement,
    createSessionOptions: async () =>
      sessionHost(attested(scripted, attemptsInside), {
        tools: [actTool()],
        permissions: { allow: ['act'], deny: [], ask: [] },
      }),
  });
}

const toolThenText = () =>
  createScriptedProvider([
    { toolCalls: [{ name: 'act', args: {} }], usage: { inputTokens: 20, outputTokens: 5 } },
    { text: 'done', usage: { inputTokens: 30, outputTokens: 6 } },
  ]);

function turn(): ParticipantTurn {
  return {
    conversationId: 'c1',
    participantId: 'p',
    turnId: 't1',
    attemptId: 'a1',
    groupId: 'g1',
    context: { baseRevision: 0, messages: [] },
  };
}

function capturing(): { services: TurnServices; calls: ModelCallIntent[] } {
  const calls: ModelCallIntent[] = [];
  return {
    calls,
    services: {
      admitModelCall: async (call) => {
        calls.push(call);
      },
      recordUsage: async () => {},
    },
  };
}

function execOptions(services: TurnServices): ParticipantExecutionOptions {
  return { signal: new AbortController().signal, onDelta: async () => {}, services };
}

const encodedBytes = (
  messages: readonly TUniversalMessage[],
  options: { tools?: unknown; responseFormat?: unknown; toolChoice?: unknown } | undefined,
) =>
  new TextEncoder().encode(
    JSON.stringify([
      messages,
      options?.tools ?? [],
      options?.responseFormat ?? null,
      options?.toolChoice ?? null,
    ]),
  ).length;

describe('sessionParticipant: enforced', () => {
  it('declares enforced with an enforcement option and metered without one', () => {
    const scripted = createScriptedProvider([]);
    expect(enforcedSession(scripted).factory.modelCalls).toBe('enforced');
    expect(
      sessionParticipant({
        id: 'p',
        runtime: { id: 'fixture/session', version: '1' },
        createSessionOptions: async () => sessionHost(scripted.provider),
      }).factory.modelCalls,
    ).toBe('metered');
  });

  it('refuses an invalid declaration when the participant is created', () => {
    expect(() =>
      sessionParticipant({
        id: 'p',
        runtime: { id: 'fixture/session', version: '1' },
        enforcement: { providerAttempts: 0, requestOverheadTokens: 0 },
        createSessionOptions: async () => {
          throw new Error('not used');
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });

  describe('refuses a Session whose calls cannot be bounded before the first call', () => {
    function participantWith(
      scripted: Scripted,
      extra: Partial<SessionHostOptions>,
      free: string[] = [],
    ) {
      return sessionParticipant({
        id: 'p',
        runtime: { id: 'fixture/session', version: '1' },
        enforcement: { ...exact, freeTools: free },
        createSessionOptions: async () => sessionHost(scripted.provider, extra),
      });
    }
    const open = (participant: ReturnType<typeof participantWith>) =>
      participant.factory.openSession({ conversationId: 'c', participantId: 'A' });

    it.each([
      ['no output cap', { maxOutputTokens: undefined }, 'maxOutputTokens'],
      ['a zero output cap', { maxOutputTokens: 0 }, 'maxOutputTokens'],
      ['automatic compaction left on', { autoCompactThreshold: undefined }, 'compaction'],
    ])('with %s', async (_label, extra, fragment) => {
      const scripted = createScriptedProvider([{ text: 'x' }]);
      await expect(open(participantWith(scripted, extra))).rejects.toMatchObject({
        code: 'unbounded-call',
        message: expect.stringContaining(fragment),
      });
      expect(scripted.requests).toHaveLength(0);
    });

    it('with a tool declared in no list, and accepts it once declared free', async () => {
      const scripted = createScriptedProvider([{ text: 'x' }]);
      await expect(open(participantWith(scripted, { tools: [actTool()] }))).rejects.toMatchObject({
        code: 'unbounded-call',
        message: 'An enforced runtime must declare every tool free or paid: act',
      });
      const lease = await open(participantWith(scripted, { tools: [actTool()] }, ['act']));
      await lease.release();
    });

    it('with provider-hosted web tools enabled, leaving the provider claimable', async () => {
      const scripted = createScriptedProvider([{ text: 'x' }]);
      const hosted = Object.assign(scripted.provider, {
        getCapabilities: () => ({
          functionCalling: { supported: true },
          nativeWebTools: {
            webSearch: { supported: true, enabled: true },
            webFetch: { supported: false, enabled: false },
          },
        }),
      });
      const participant = sessionParticipant({
        id: 'p',
        runtime: { id: 'fixture/session', version: '1' },
        enforcement: exact,
        createSessionOptions: async () => sessionHost(hosted),
      });
      const attempt = () =>
        participant.factory.openSession({ conversationId: 'c', participantId: 'A' });
      await expect(attempt()).rejects.toMatchObject({ code: 'unbounded-call' });
      // A refusal at the lease never claims the provider, so a second open fails the same way
      // instead of reporting the provider as held.
      await expect(attempt()).rejects.toMatchObject({ code: 'unbounded-call' });
      expect(scripted.requests).toHaveLength(0);
    });
  });

  it('bounds what the provider actually receives', async () => {
    const scripted = toolThenText();
    const participant = enforcedSession(scripted, {
      providerAttempts: 1,
      requestOverheadTokens: 0,
      freeTools: ['act'],
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'p',
    });
    const { services, calls } = capturing();
    await lease.session.runTurn(turn(), execOptions(services));
    expect(scripted.requests).toHaveLength(2);
    expect(calls).toHaveLength(2);
    scripted.requests.forEach((messages, index) => {
      const options = scripted.chatOptions[index];
      const bound = calls[index]!.bound!;
      expect(encodedBytes(messages, options)).toBeLessThanOrEqual(bound.inputTokens);
      expect(options?.maxTokens).toBeGreaterThan(0);
      expect(options!.maxTokens!).toBeLessThanOrEqual(bound.maxOutputTokens);
    });
    await lease.release();
  });
});

describe('a budgeted conversation with enforced participants', () => {
  function room(
    participant: ReturnType<typeof enforcedSession>,
    budgetTokens: number,
    store = new MemoryConversationStore(),
  ) {
    return createRoundtable({
      conversationId: 'budgeted',
      store,
      participants: [participant],
      limits: { maxTurnsPerRun: 1 },
      budget: { tokens: budgetTokens },
    });
  }

  it('runs to completion, admitting every call with its bound and settling reported usage', async () => {
    const scripted = toolThenText();
    const budgeted = room(enforcedSession(scripted), 1_000_000);
    const result = await budgeted.run();
    expect(result.status).toBe('limited');
    expect(scripted.requests).toHaveLength(2);
    const usage = budgeted.snapshot().usage;
    expect(usage).toHaveLength(2);
    for (const record of usage) {
      expect(record.bound).toBeDefined();
      expect(record).toMatchObject({ status: 'settled', provenance: 'reported' });
    }
    expect(usage.map((record) => record.status === 'settled' && record.tokens)).toEqual([
      { input: 20, output: 5 },
      { input: 30, output: 6 },
    ]);
    await budgeted.dispose();
  });

  it('admits a budget equal to the exact bound and refuses one token less with no provider call', async () => {
    const probe = createScriptedProvider([
      { text: 'hi', usage: { inputTokens: 5, outputTokens: 2 } },
    ]);
    const probing = room(enforcedSession(probe), 1_000_000);
    await probing.run();
    const bound = probing.snapshot().usage[0]!.bound!;
    const needed = bound.inputTokens + bound.maxOutputTokens;
    await probing.dispose();

    const fits = createScriptedProvider([
      { text: 'hi', usage: { inputTokens: 5, outputTokens: 2 } },
    ]);
    const fitting = room(enforcedSession(fits), needed);
    await fitting.run();
    expect(fits.requests).toHaveLength(1);
    await fitting.dispose();

    const short = createScriptedProvider([
      { text: 'hi', usage: { inputTokens: 5, outputTokens: 2 } },
    ]);
    const refusing = room(enforcedSession(short), needed - 1);
    const result = await refusing.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(short.requests).toHaveLength(0);
    await refusing.dispose();
  });

  it('covers every attempt inside one call with one admission, keeps the bound as partial until reconciled', async () => {
    const attempts = 3;
    const scripted = createScriptedProvider([
      { text: 'a', usage: { inputTokens: 7, outputTokens: 2 } },
      { text: 'a', usage: { inputTokens: 7, outputTokens: 2 } },
      { text: 'a', usage: { inputTokens: 7, outputTokens: 2 } },
    ]);
    const participant = enforcedSession(
      scripted,
      { providerAttempts: attempts, requestOverheadTokens: 0, freeTools: ['act'] },
      attempts,
    );
    const budgeted = room(participant, 1_000_000);
    await budgeted.run();
    expect(scripted.requests).toHaveLength(attempts);
    const [record] = budgeted.snapshot().usage;
    expect(budgeted.snapshot().usage).toHaveLength(1);
    const bound = record!.bound!;
    // The bound covers all attempts: output is the cap times the attempts.
    expect(bound.maxOutputTokens).toBe(64 * attempts);
    expect(bound.inputTokens).toBeGreaterThanOrEqual(
      attempts * encodedBytes(scripted.requests[0]!, scripted.chatOptions[0]),
    );
    expect(record).toMatchObject({ status: 'settled', provenance: 'partial' });
    expect(record!.reconciled).toBeNull();
    await budgeted.reconcileUsage({ callId: record!.callId, tokens: 9 });
    expect(budgeted.snapshot().usage[0]!.reconciled).toMatchObject({ tokens: 9 });
    await budgeted.dispose();
  });

  it('is accepted again when the conversation is loaded with the same enforced participant', async () => {
    const scripted = createScriptedProvider([
      { text: 'first', usage: { inputTokens: 5, outputTokens: 2 } },
    ]);
    const participant = enforcedSession(scripted);
    const store = new MemoryConversationStore();
    const budgeted = room(participant, 1_000_000, store);
    await budgeted.run();
    await budgeted.dispose();
    const registry: RoundtableRegistry = {
      resolveParticipant: async () => ({
        reference: participant.runtime,
        factory: participant.factory,
      }),
    };
    const reloaded = await loadRoundtable({ conversationId: 'budgeted', store, registry });
    expect(reloaded.snapshot().usage).toHaveLength(1);
    await reloaded.dispose();
  });
});

describe('runtimeParticipant and runtimeSelector: enforced', () => {
  function agent(scripted: Scripted, name: string, maxTokens: number | null = 64) {
    const provider = attested(scripted);
    return new ConversationAgent({
      name,
      aiProviders: [provider],
      defaultModel: {
        provider: provider.name,
        model: 'test-model',
        ...(maxTokens !== null ? { maxTokens } : {}),
      },
    });
  }

  it('runs a budgeted conversation, bounding both the selector decision and the turn', async () => {
    const decisions = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['p'] } },
        ],
        usage: { inputTokens: 40, outputTokens: 8 },
      },
      {
        toolCalls: [{ name: 'decide_next_speaker', args: { action: 'finish' } }],
        usage: { inputTokens: 60, outputTokens: 8 },
      },
    ]);
    const speaker = createScriptedProvider([
      { text: 'hello', usage: { inputTokens: 10, outputTokens: 3 } },
    ]);
    const budgeted = createRoundtable({
      conversationId: 'enforced-runtime',
      participants: [
        runtimeParticipant({
          id: 'p',
          runtime: { id: 'fixture/agent', version: '1' },
          enforcement: exact,
          createAgent: async () => agent(speaker, 'speaker'),
        }),
      ],
      selector: runtimeSelector({
        reference: { id: 'fixture/selector', version: '1' },
        enforcement: exact,
        createAgent: async () => agent(decisions, 'selector'),
      }),
      limits: { maxTurnsPerRun: 5 },
      budget: { tokens: 1_000_000 },
    });
    const result = await budgeted.run();
    expect(result.status).toBe('completed');
    const usage = budgeted.snapshot().usage;
    expect(usage.map((record) => record.principal.kind)).toEqual([
      'selector',
      'participant',
      'selector',
    ]);
    for (const record of usage) {
      expect(record.bound).toBeDefined();
      expect(record).toMatchObject({ status: 'settled', provenance: 'reported' });
    }
    await budgeted.dispose();
  });

  it('ends limited before any provider call when the selector decision does not fit', async () => {
    const decisions = createScriptedProvider([
      { toolCalls: [{ name: 'decide_next_speaker', args: { action: 'finish' } }] },
    ]);
    const speaker = createScriptedProvider([{ text: 'never' }]);
    const budgeted = createRoundtable({
      conversationId: 'enforced-runtime-small',
      participants: [
        runtimeParticipant({
          id: 'p',
          runtime: { id: 'fixture/agent', version: '1' },
          enforcement: exact,
          createAgent: async () => agent(speaker, 'speaker'),
        }),
      ],
      selector: runtimeSelector({
        reference: { id: 'fixture/selector', version: '1' },
        enforcement: exact,
        createAgent: async () => agent(decisions, 'selector'),
      }),
      limits: { maxTurnsPerRun: 5 },
      budget: { tokens: 10 },
    });
    const result = await budgeted.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(decisions.requests).toHaveLength(0);
    expect(speaker.requests).toHaveLength(0);
    await budgeted.dispose();
  });

  it('refuses a runtime agent without an output cap and destroys it', async () => {
    const scripted = createScriptedProvider([{ text: 'x' }]);
    const capless = agent(scripted, 'capless', null);
    let destroyed = false;
    const original = capless.destroy.bind(capless);
    capless.destroy = async () => {
      destroyed = true;
      return original();
    };
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      enforcement: exact,
      createAgent: async () => capless,
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'A' }),
    ).rejects.toMatchObject({
      code: 'unbounded-call',
      message: expect.stringContaining('defaultModel.maxTokens'),
    });
    expect(destroyed).toBe(true);
    expect(scripted.requests).toHaveLength(0);
  });

  it('refuses a selector agent without an output cap before any provider call', async () => {
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'decide_next_speaker', args: { action: 'finish' } }] },
    ]);
    const selector = runtimeSelector({
      reference: { id: 'fixture/selector', version: '1' },
      enforcement: exact,
      createAgent: async () => agent(scripted, 'selector', null),
    });
    await expect(
      selector.select(
        {
          participants: [{ id: 'a', kind: 'agent' }],
          messages: [],
          turns: [],
          remainingTurns: 3,
        },
        { signal: new AbortController().signal, services: capturing().services },
      ),
    ).rejects.toMatchObject({ code: 'unbounded-call' });
    expect(scripted.requests).toHaveLength(0);
  });

  it('refuses a null enforcement instead of reading it as absent', () => {
    const unused = () => {
      throw new Error('not used');
    };
    const nothing = null as unknown as RuntimeEnforcement;
    expect(() =>
      runtimeParticipant({
        id: 'p',
        runtime: { id: 'f', version: '1' },
        enforcement: nothing,
        createAgent: unused,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
    expect(() =>
      runtimeSelector({
        reference: { id: 's', version: '1' },
        enforcement: nothing,
        createAgent: unused,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
    expect(() =>
      sessionParticipant({
        id: 'p',
        runtime: { id: 'f', version: '1' },
        enforcement: nothing,
        createSessionOptions: unused,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });

  it('declares enforced only with an enforcement option, and validates it at creation', () => {
    const unused = () => {
      throw new Error('not used');
    };
    expect(
      runtimeParticipant({
        id: 'p',
        runtime: { id: 'f', version: '1' },
        createAgent: unused,
      }).factory.modelCalls,
    ).toBe('metered');
    expect(
      runtimeSelector({ reference: { id: 's', version: '1' }, createAgent: unused }).modelCalls,
    ).toBe('metered');
    expect(() =>
      runtimeSelector({
        reference: { id: 's', version: '1' },
        enforcement: { providerAttempts: 1, requestOverheadTokens: -1 },
        createAgent: unused,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
    expect(() =>
      runtimeParticipant({
        id: 'p',
        runtime: { id: 'f', version: '1' },
        enforcement: { providerAttempts: 1.5, requestOverheadTokens: 0 },
        createAgent: unused,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });
});
