import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool, Robota, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
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
});
