import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool, Robota, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { SelectionContext, TurnServices } from '@robota-sdk/agent-roundtable';
import { robotaSelector, robotaSelectorRegistration } from './robota-selector';
import { SelectorDecisionError } from './errors';

afterEach(() => {
  clearRegisteredToolProfiles();
});

function noServices(): TurnServices {
  return { admitModelCall: async () => {}, recordUsage: async () => {} };
}

function context(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    participants: [
      { id: 'a', kind: 'agent' },
      { id: 'b', kind: 'agent' },
    ],
    messages: [],
    turns: [],
    remainingTurns: 5,
    ...overrides,
  };
}

function agentFor(scripted: ReturnType<typeof createScriptedProvider>, extraTools: unknown[] = []) {
  return new Robota({
    name: 'selector',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    ...(extraTools.length ? { tools: extraTools as never } : {}),
  });
}

describe('robotaSelector', () => {
  it('rejects an empty candidate list with no-candidates and no provider call', async () => {
    const scripted = createScriptedProvider([]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    await expect(
      selector.select(context({ participants: [] }), {
        signal: new AbortController().signal,
        services: noServices(),
      }),
    ).rejects.toMatchObject({ code: 'no-candidates' });
    expect(scripted.requests).toHaveLength(0);
  });

  it('rejects a text-only reply with no-decision, making exactly one provider call', async () => {
    const scripted = createScriptedProvider([{ text: 'I am thinking about it' }]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    await expect(
      selector.select(context(), { signal: new AbortController().signal, services: noServices() }),
    ).rejects.toMatchObject({ code: 'no-decision' });
    expect(scripted.requests).toHaveLength(1);
  });

  it('rejects two decision calls with multiple-decisions', async () => {
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['a'] } },
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['b'] } },
        ],
      },
    ]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    await expect(
      selector.select(context(), { signal: new AbortController().signal, services: noServices() }),
    ).rejects.toMatchObject({ code: 'multiple-decisions' });
  });

  it('rejects an id outside the candidate list with unknown-participant', async () => {
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['ghost'] } },
        ],
      },
    ]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    await expect(
      selector.select(context(), { signal: new AbortController().signal, services: noServices() }),
    ).rejects.toMatchObject({ code: 'unknown-participant' });
  });

  it.each([{ participantIds: ['a', 'a'] }, { participantIds: [] }])(
    'rejects a duplicated or empty participant set (%#) with invalid-decision',
    async (args) => {
      const scripted = createScriptedProvider([
        { toolCalls: [{ name: 'decide_next_speaker', args: { action: 'speak', ...args } }] },
      ]);
      const selector = robotaSelector({
        reference: { id: 'fixture/selector', version: '1' },
        createAgent: async () => agentFor(scripted),
      });
      await expect(
        selector.select(context(), {
          signal: new AbortController().signal,
          services: noServices(),
        }),
      ).rejects.toMatchObject({ code: 'invalid-decision' });
    },
  );

  it('maps a multi-id decision to a parallel Selection', async () => {
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['a', 'b'] } },
        ],
      },
    ]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    const selection = await selector.select(context(), {
      signal: new AbortController().signal,
      services: noServices(),
    });
    expect(selection).toEqual({ kind: 'parallel', participantIds: ['a', 'b'] });
    expect(scripted.requests).toHaveLength(1);
  });

  it('admits exactly one metered provider call per decision', async () => {
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['a'] } },
        ],
      },
    ]);
    const admitted: unknown[] = [];
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    const selection = await selector.select(context(), {
      signal: new AbortController().signal,
      services: {
        admitModelCall: async (call) => {
          admitted.push(call);
        },
        recordUsage: async () => {},
      },
    });
    expect(selection).toEqual({ kind: 'speak', participantId: 'a' });
    expect(admitted).toHaveLength(1);
  });

  it('rejects before any provider call when the selector agent carries its own tools', async () => {
    const scripted = createScriptedProvider([{ text: 'must not be reached' }]);
    const other = new FunctionTool(
      {
        name: 'other',
        description: 'not the decision tool',
        parameters: { type: 'object', properties: {} },
      },
      async () => 'x',
    );
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted, [other]),
    });
    await expect(
      selector.select(context(), { signal: new AbortController().signal, services: noServices() }),
    ).rejects.toMatchObject({ code: 'invalid-decision' });
    expect(scripted.requests).toHaveLength(0);
  });

  it('maps a finish decision to a finish Selection', async () => {
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'finish', reason: 'all done' } },
        ],
      },
    ]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    const selection = await selector.select(context(), {
      signal: new AbortController().signal,
      services: noServices(),
    });
    expect(selection).toEqual({ kind: 'finish', reason: 'all done' });
  });

  it('robotaSelectorRegistration creates a fresh selector with the same reference', async () => {
    const scripted = createScriptedProvider([]);
    const reference = { id: 'fixture/selector', version: '1' };
    const registration = robotaSelectorRegistration({
      reference,
      createAgent: async () => agentFor(scripted),
    });
    expect(registration.reference).toEqual(reference);
    const selector = await registration.create({});
    expect(selector.reference).toEqual(reference);
  });

  it('does not retry a failed decision internally: one attempt, one provider call', async () => {
    const scripted = createScriptedProvider([{ text: 'no tool call here' }]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    await expect(
      selector.select(context(), { signal: new AbortController().signal, services: noServices() }),
    ).rejects.toBeInstanceOf(SelectorDecisionError);
    expect(scripted.requests).toHaveLength(1);
  });

  // A cancelled selection used to leave the decision tool on the reused agent forever, because
  // `updateTools([])` never ran once `agent.run` rejected. The realistic way a run rejects while
  // cancelled is agent-core's own hardening (CORE-027 / ExecutionJournalError): a rejected
  // admission is wrapped in an error that is rethrown even though the signal is aborted, exactly
  // what a real ledger does once a run has been cancelled.
  it('resets the decision tool after a cancelled selection, so the next select succeeds', async () => {
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['a'] } },
        ],
      },
    ]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    const controller = new AbortController();
    const cancelledDuringAdmission: TurnServices = {
      admitModelCall: async () => {
        controller.abort();
        throw new Error('turn cancelled');
      },
      recordUsage: async () => {},
    };
    await expect(
      selector.select(context(), { signal: controller.signal, services: cancelledDuringAdmission }),
    ).rejects.toThrow();
    // The cancelled attempt never reached the provider — its call is still on the script for the
    // next, uncancelled select() below.
    expect(scripted.requests).toHaveLength(0);

    const selection = await selector.select(context(), {
      signal: new AbortController().signal,
      services: noServices(),
    });
    expect(selection).toEqual({ kind: 'speak', participantId: 'a' });
  });

  // The selector used to decide purely from ids and outcome kinds, never what was said.
  it('renders the shared conversation into the decision prompt', async () => {
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['a'] } },
        ],
      },
    ]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    await selector.select(
      context({
        messages: [
          {
            id: 'm1',
            participantId: 'a',
            content: 'the plan is ready',
            revision: 1,
            turnId: 't0',
            groupId: 'g0',
          },
        ],
      }),
      { signal: new AbortController().signal, services: noServices() },
    );
    const sent = scripted.requests[0]!.find((m) => m.role === 'user');
    expect(sent?.content).toContain('the plan is ready');
    expect(sent?.content).toContain('From a');
  });

  // The reused agent accumulated private history across decisions with no checkpoint, so a
  // live selector and a freshly reloaded one (which starts with no history at all) could
  // decide differently from the same SelectionContext, and cost grew unbounded across a whole run.
  it('clears the reused agent history before each decision', async () => {
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['a'] } },
        ],
      },
      {
        toolCalls: [
          { name: 'decide_next_speaker', args: { action: 'speak', participantIds: ['b'] } },
        ],
      },
    ]);
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agentFor(scripted),
    });
    await selector.select(context(), {
      signal: new AbortController().signal,
      services: noServices(),
    });
    await selector.select(context(), {
      signal: new AbortController().signal,
      services: noServices(),
    });
    // The second decision's request carries only ITS OWN prompt and reply, not the first
    // decision's leftover history — one user message and nothing from the first round's tool call.
    const secondRequest = scripted.requests[1]!;
    expect(secondRequest.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(secondRequest.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('rejects a second select() call that overlaps an in-flight one on the same instance', async () => {
    const blocking: IAIProvider = {
      name: 'blocking',
      version: 'test',
      chat: () => new Promise(() => {}),
      generateResponse: async () => ({ content: '' }),
      supportsTools: () => true,
      validateConfig: () => true,
    };
    const agent = new Robota({
      name: 'selector',
      aiProviders: [blocking],
      defaultModel: { provider: blocking.name, model: 'test-model' },
    });
    const selector = robotaSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () => agent,
    });
    const firstController = new AbortController();
    // Never awaited before the second call starts: select() runs synchronously up to its first
    // `await`, so the guard it sets is already in place by the time this line returns.
    const first = selector.select(context(), {
      signal: firstController.signal,
      services: noServices(),
    });
    await expect(
      selector.select(context(), {
        signal: new AbortController().signal,
        services: noServices(),
      }),
    ).rejects.toMatchObject({ code: 'resource-reused' });
    firstController.abort(new Error('cleanup'));
    await Promise.resolve(first).catch(() => {});
  });
});
