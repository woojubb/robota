import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool, Robota, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type {
  IToolExecutionContext,
  TToolEffectAdmission,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type {
  ParticipantExecutionOptions,
  ParticipantTurn,
  TurnServices,
} from '@robota-sdk/agent-roundtable';
import { robotaParticipant } from './robota-participant';

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

describe('robotaParticipant: speak path', () => {
  it('speaks the agent run() result and delivers deltas in order', async () => {
    const scripted = createScriptedProvider([{ text: 'hello from robota' }]);
    const participant = robotaParticipant({
      id: 'p',
      runtime: { id: 'fixture/robota', version: '1' },
      createAgent: async () =>
        new Robota({
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
    expect(outcome).toEqual({ kind: 'speak', content: 'hello from robota' });
    expect(received).toEqual(['hello from robota']);
    await lease.release();
  });

  it('admits every model call through the bound TurnServices', async () => {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    const participant = robotaParticipant({
      id: 'p',
      runtime: { id: 'fixture/robota', version: '1' },
      createAgent: async () =>
        new Robota({
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
    const agent = new Robota({
      name: 'fixture',
      aiProviders: [scripted.provider],
      defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    });
    const destroy = vi.spyOn(agent, 'destroy');
    const participant = robotaParticipant({
      id: 'p',
      runtime: { id: 'fixture/robota', version: '1' },
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

  it('fails a suspended execution with unsupported-wait; robotaParticipant has no continuation', async () => {
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
    const participant = robotaParticipant({
      id: 'p',
      runtime: { id: 'fixture/robota', version: '1' },
      createAgent: async () =>
        new Robota({
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
    const participant = robotaParticipant({
      id: 'p',
      runtime: { id: 'fixture/robota', version: '1' },
      createAgent: async () => {
        throw new Error('not used in this test');
      },
    });
    expect(participant.factory.supportsContinuation).toBeUndefined();
    expect(participant.factory.checkpointVersions).toEqual(['robota-agent/1']);
    expect(participant.factory.modelCalls).toBe('metered');
  });
});
