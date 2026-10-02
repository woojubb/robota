import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool, ConversationAgent, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  IToolExecutionContext,
  TToolEffectAdmission,
  TToolParameters,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { createRoundtable } from '@robota-sdk/agent-roundtable';
import type {
  ParticipantExecutionOptions,
  ParticipantTurn,
  TurnServices,
} from '@robota-sdk/agent-roundtable';
import { runtimeParticipant } from './runtime-participant';

afterEach(() => {
  clearRegisteredToolProfiles();
});

function noServices(): TurnServices {
  return { admitModelCall: async () => {}, recordUsage: async () => {} };
}

function turn(overrides: Partial<ParticipantTurn> = {}): ParticipantTurn {
  return {
    conversationId: 'c1',
    participantId: 'p1',
    turnId: 't1',
    attemptId: 'a1',
    groupId: 'g1',
    context: { baseRevision: 0, messages: [] },
    ...overrides,
  };
}

function execOptions(
  overrides: Partial<ParticipantExecutionOptions> = {},
): ParticipantExecutionOptions {
  return {
    signal: new AbortController().signal,
    onDelta: async () => {},
    services: noServices(),
    ...overrides,
  };
}

describe('runtimeParticipant: speak path', () => {
  it('speaks the agent run() result and delivers deltas in order', async () => {
    const scripted = createScriptedProvider([{ text: 'hello from agent' }]);
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () =>
        new ConversationAgent({
          name: 'fixture',
          aiProviders: [scripted.provider],
          defaultModel: { provider: scripted.provider.name, model: 'test-model' },
        }),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const received: string[] = [];
    const outcome = await lease.session.runTurn(
      turn(),
      execOptions({
        onDelta: async (text) => {
          received.push(text);
        },
      }),
    );
    expect(outcome).toEqual({ kind: 'speak', content: 'hello from agent' });
    expect(received).toEqual(['hello from agent']);
    await lease.release();
  });

  it('admits every model call through the bound TurnServices', async () => {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () =>
        new ConversationAgent({
          name: 'fixture',
          aiProviders: [scripted.provider],
          defaultModel: { provider: scripted.provider.name, model: 'test-model' },
        }),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const admitted: unknown[] = [];
    const services: TurnServices = {
      admitModelCall: async (call) => {
        admitted.push(call);
      },
      recordUsage: async () => {},
    };
    await lease.session.runTurn(turn(), execOptions({ services }));
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({
      providerId: scripted.provider.name,
      modelId: 'test-model',
    });
    await lease.release();
  });

  it('destroys the underlying agent exactly once', async () => {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    const agent = new ConversationAgent({
      name: 'fixture',
      aiProviders: [scripted.provider],
      defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    });
    const destroy = vi.spyOn(agent, 'destroy');
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () => agent,
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    await lease.release();
    await lease.release();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('fails a suspended execution with unsupported-wait; runtimeParticipant has no continuation', async () => {
    const scripted = createScriptedProvider([{ toolCalls: [{ name: 'act', args: {} }] }]);
    const effect = vi.fn(async () => 'effect result');
    const base = new FunctionTool(
      { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      effect,
    );
    const tool = Object.assign(base, {
      executeWithAdmission: async (
        parameters: TToolParameters,
        context: IToolExecutionContext,
        admit: TToolEffectAdmission,
      ) => {
        if (context.continuation) {
          await context.continuation.request({ kind: 'fixture/approval', data: {} });
        }
        await admit(parameters);
        return base.execute(parameters, context);
      },
    });
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () =>
        new ConversationAgent({
          name: 'fixture',
          aiProviders: [scripted.provider],
          defaultModel: { provider: scripted.provider.name, model: 'test-model' },
          tools: [tool],
        }),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    await expect(lease.session.runTurn(turn(), execOptions())).rejects.toMatchObject({
      code: 'unsupported-wait',
    });
    expect(effect).not.toHaveBeenCalled();
    await lease.release();
  });

  it('declares no wait continuation and a robota-agent/1 checkpoint version', () => {
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () => {
        throw new Error('not used in this test');
      },
    });
    expect(participant.factory.supportsContinuation).toBeUndefined();
    expect(participant.factory.checkpointVersions).toEqual(['robota-agent/1']);
    expect(participant.factory.modelCalls).toBe('metered');
  });

  // `agent.run()` RESOLVES on abort (agent-core CORE-027) with the text it had committed so far,
  // marked `interrupted` — never rejects on its own. A tool call combined with real text in the
  // SAME assistant message, where the tool's own effect aborts mid round, reproduces exactly
  // that: the round loop stops after the tool (no further round runs the forced summary), so the
  // committed text from round 1 becomes `result.response`, resolved, while `signal.aborted` is true.
  it('throws the abort reason instead of publishing text committed during a cancelled tool round', async () => {
    const controller = new AbortController();
    const provider: IAIProvider = {
      name: 'abort-mid-tool-round',
      version: 'test',
      async chat(): Promise<TUniversalMessage> {
        return {
          id: 'r1',
          role: 'assistant',
          content: 'partial reasoning before the abort',
          state: 'complete',
          timestamp: new Date(),
          toolCalls: [
            { id: 'call-1', type: 'function', function: { name: 'act', arguments: '{}' } },
          ],
        };
      },
      async generateResponse() {
        return { content: '' };
      },
      supportsTools: () => true,
      validateConfig: () => true,
    };
    const tool = new FunctionTool(
      { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      async () => {
        controller.abort(new Error('cancelled mid tool round'));
        return 'tool done';
      },
    );
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () =>
        new ConversationAgent({
          name: 'fixture',
          aiProviders: [provider],
          defaultModel: { provider: provider.name, model: 'test-model' },
          tools: [tool],
        }),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    // The turn must reject rather than settle — settling (with any outcome at all) is what would
    // let this cancelled turn's text reach the shared transcript on the next run. Streamed deltas
    // (a live, ephemeral preview, delivered as the round produces them) are a separate contract
    // from the turn's final outcome and are not asserted here.
    await expect(
      lease.session.runTurn(turn(), execOptions({ signal: controller.signal })),
    ).rejects.toThrow('cancelled mid tool round');
    await lease.release();
  });

  // Leasing only the ConversationAgent object let two participants share the SAME provider or tool
  // undetected; `agent.destroy()` on release then closed it under the other participant.
  it('rejects a second participant whose agent shares a provider with a still-open lease', async () => {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () =>
        new ConversationAgent({
          name: 'fixture',
          aiProviders: [scripted.provider],
          defaultModel: { provider: scripted.provider.name, model: 'test-model' },
        }),
    });
    const first = await participant.factory.openSession({
      conversationId: 'c1',
      participantId: 'A',
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c2', participantId: 'B' }),
    ).rejects.toMatchObject({ code: 'resource-reused' });
    await first.release();
    // Released: a second lease over the same provider now opens fine.
    await expect(
      participant.factory.openSession({ conversationId: 'c2', participantId: 'B' }),
    ).resolves.toBeDefined();
  });

  it('rejects a second participant whose agent shares a tool with a still-open lease', async () => {
    const scriptedA = createScriptedProvider([{ text: 'ok a' }]);
    const scriptedB = createScriptedProvider([{ text: 'ok b' }]);
    const sharedTool = new FunctionTool(
      { name: 'shared', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      async () => 'x',
    );
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async (ctx) =>
        new ConversationAgent({
          name: 'fixture',
          aiProviders: [ctx.participantId === 'A' ? scriptedA.provider : scriptedB.provider],
          defaultModel: {
            provider: ctx.participantId === 'A' ? scriptedA.provider.name : scriptedB.provider.name,
            model: 'test-model',
          },
          tools: [sharedTool],
        }),
    });
    const first = await participant.factory.openSession({
      conversationId: 'c1',
      participantId: 'A',
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c2', participantId: 'B' }),
    ).rejects.toMatchObject({ code: 'resource-reused' });
    await first.release();
  });

  it('leaves the open lease and its shared provider intact when a second lease is refused', async () => {
    const shared = createScriptedProvider([{ text: 'ok' }]);
    const close = vi.fn(async () => {});
    shared.provider.close = close;
    let secondDestroy: ReturnType<typeof vi.spyOn> | undefined;
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async (ctx) => {
        const agent = new ConversationAgent({
          name: 'fixture',
          aiProviders: [shared.provider],
          defaultModel: { provider: shared.provider.name, model: 'test-model' },
        });
        if (ctx.participantId === 'B') secondDestroy = vi.spyOn(agent, 'destroy');
        return agent;
      },
    });
    const first = await participant.factory.openSession({
      conversationId: 'c1',
      participantId: 'A',
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c2', participantId: 'B' }),
    ).rejects.toMatchObject({ code: 'resource-reused' });
    // The refused lease never owned the shared provider, so it must not close it.
    expect(secondDestroy).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await expect(first.session.runTurn(turn(), execOptions())).resolves.toEqual({
      kind: 'speak',
      content: 'ok',
    });
    await first.release();
  });

  it('destroys the agent it just created when its checkpoint fails to decode', async () => {
    const scripted = createScriptedProvider([]);
    let created: ConversationAgent | undefined;
    let destroy: ReturnType<typeof vi.spyOn> | undefined;
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () => {
        const agent = new ConversationAgent({
          name: 'fixture',
          aiProviders: [scripted.provider],
          defaultModel: { provider: scripted.provider.name, model: 'test-model' },
        });
        created = agent;
        destroy = vi.spyOn(agent, 'destroy');
        return agent;
      },
    });
    await expect(
      participant.factory.openSession({
        conversationId: 'c',
        participantId: 'A',
        checkpoint: { version: 'not-a-real-version', data: [] },
      }),
    ).rejects.toMatchObject({ code: 'checkpoint-invalid' });
    expect(created).toBeDefined();
    expect(destroy).toHaveBeenCalledOnce();
    // The lease was released on failure too: opening again over the same provider now succeeds.
    await expect(
      participant.factory.openSession({ conversationId: 'c2', participantId: 'B' }),
    ).resolves.toBeDefined();
  });
});

describe('runtimeParticipant: cancellation while a delta is in flight', () => {
  it('ends the run cancelled and raises no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    const controller = new AbortController();
    const provider: IAIProvider = {
      name: 'streamer',
      version: 'test',
      async chat(_messages, options): Promise<TUniversalMessage> {
        for (const chunk of ['one ', 'two ', 'three ']) {
          (options as { onTextDelta?: (text: string) => void } | undefined)?.onTextDelta?.(chunk);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (options?.signal?.aborted) throw options.signal.reason;
        return {
          id: 'r1',
          role: 'assistant',
          content: 'one two three',
          state: 'complete',
          timestamp: new Date(),
        };
      },
      async generateResponse() {
        return { content: '' };
      },
      supportsTools: () => false,
      validateConfig: () => true,
    };
    const room = createRoundtable({
      conversationId: 'crash-probe',
      participants: [
        runtimeParticipant({
          id: 'a',
          runtime: { id: 'fixture/agent', version: '1' },
          createAgent: async () =>
            new ConversationAgent({
              name: 'fixture',
              aiProviders: [provider],
              defaultModel: { provider: provider.name, model: 'test-model' },
            }),
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
      // Slow enough (an awaited host handler, e.g. writing a delta out to a socket) that a delta
      // pushed to the queue is still undelivered at the moment the run is cancelled.
      onEvent: async (event) => {
        if (event.type === 'delta') await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    setTimeout(() => controller.abort(new Error('user pressed stop')), 8);
    const result = await room.run({ signal: controller.signal });
    // Long enough for a rejection any earlier link left unhandled to be reported.
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.off('unhandledRejection', onUnhandledRejection);
    await room.dispose();
    expect(result.status).toBe('cancelled');
    expect(unhandled).toEqual([]);
  });
});
