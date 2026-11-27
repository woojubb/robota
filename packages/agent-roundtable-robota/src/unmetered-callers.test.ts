import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { ConversationAgent, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { SelectionContext, TurnServices } from '@robota-sdk/agent-roundtable';
import { runtimeParticipant } from './runtime-participant';
import { runtimeSelector } from './runtime-selector';
import { sessionParticipant, type SessionHostOptions } from './session-participant';

afterEach(() => {
  clearRegisteredToolProfiles();
});

function noServices(): TurnServices {
  return {
    admitModelCall: async () => {},
    recordUsage: async () => {},
    admitToolEffect: async () => {
      throw new Error('a tool effect must not be admitted here');
    },
  };
}

function hostOptions(
  provider: IAIProvider,
  extra: Partial<SessionHostOptions> = {},
): SessionHostOptions {
  return {
    cwd: process.cwd(),
    hookTypeExecutors: [],
    tools: [],
    provider,
    systemMessage: 'Fixture host',
    model: 'test-model',
    autoCompactThreshold: false,
    ...extra,
  };
}

function routingProvider(scripted: ReturnType<typeof createScriptedProvider>): IAIProvider {
  return Object.assign(scripted.provider, {
    resolveModelRoute: () => ({ provider: 'other', model: 'm' }),
  });
}

function managedProvider(): IAIProvider {
  return {
    kind: 'managed-run',
    name: 'managed',
    version: '1',
    run: vi.fn(),
    validateConfig: () => true,
  } as unknown as IAIProvider;
}

describe('sessionParticipant: callers outside the journal are refused before the first call', () => {
  function participantFor(provider: IAIProvider, extra: Partial<SessionHostOptions> = {}) {
    return sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(provider, extra),
    });
  }
  const open = (participant: ReturnType<typeof participantFor>) =>
    participant.factory.openSession({ conversationId: 'c', participantId: 'A' });

  it('refuses a permission classifier without ever calling it', async () => {
    const scripted = createScriptedProvider([{ text: 'x' }]);
    const classify = vi.fn(async () => undefined);
    const participant = participantFor(scripted.provider, { permissionClassifier: { classify } });
    await expect(open(participant)).rejects.toMatchObject({ code: 'unmetered-caller' });
    expect(classify).not.toHaveBeenCalled();
    expect(scripted.requests).toHaveLength(0);
  });

  it('refuses a provider that can route a request to another model', async () => {
    const scripted = createScriptedProvider([{ text: 'x' }]);
    await expect(open(participantFor(routingProvider(scripted)))).rejects.toMatchObject({
      code: 'unmetered-caller',
    });
    expect(scripted.requests).toHaveLength(0);
  });

  it('refuses a managed-run provider', async () => {
    const managed = managedProvider();
    await expect(open(participantFor(managed))).rejects.toMatchObject({
      code: 'unmetered-caller',
    });
    expect((managed as unknown as { run: unknown }).run).not.toHaveBeenCalled();
  });

  it.each(['prompt', 'agent'] as const)(
    'refuses a %s hook executor before any SessionStart hook runs',
    async (type) => {
      const scripted = createScriptedProvider([{ text: 'x' }]);
      const execute = vi.fn(async () => ({ kind: 'pass' }) as never);
      const participant = participantFor(scripted.provider, {
        hookTypeExecutors: [{ type, execute }],
        hooks: { SessionStart: [{ hooks: [{ type, prompt: 'p', agent: 'a' }] }] },
      });
      await expect(open(participant)).rejects.toMatchObject({ code: 'unmetered-caller' });
      expect(execute).not.toHaveBeenCalled();
      expect(scripted.requests).toHaveLength(0);
    },
  );

  it('leaves the provider claimable after a refused open', async () => {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    let refuse = true;
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () =>
        hostOptions(
          scripted.provider,
          refuse ? { permissionClassifier: { classify: vi.fn() } } : {},
        ),
    });
    await expect(open(participant)).rejects.toMatchObject({ code: 'unmetered-caller' });
    refuse = false;
    const lease = await open(participant);
    await lease.release();
  });
});

describe('runtimeParticipant: callers outside the journal are refused before the first call', () => {
  it('refuses a provider that can route a request to another model and destroys the agent', async () => {
    const scripted = createScriptedProvider([{ text: 'x' }]);
    const routing = routingProvider(scripted);
    const agent = new ConversationAgent({
      name: 'fixture',
      aiProviders: [routing],
      defaultModel: { provider: routing.name, model: 'test-model' },
    });
    const destroy = vi.spyOn(agent, 'destroy');
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () => agent,
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'A' }),
    ).rejects.toMatchObject({ code: 'unmetered-caller' });
    expect(destroy).toHaveBeenCalledOnce();
    expect(scripted.requests).toHaveLength(0);
  });

  it('refuses a managed-run provider and destroys the agent', async () => {
    const destroy = vi.fn(async () => {});
    const agent = {
      getConfig: () => ({ aiProviders: [managedProvider()] }),
      destroy,
    } as unknown as ConversationAgent;
    const participant = runtimeParticipant({
      id: 'p',
      runtime: { id: 'fixture/agent', version: '1' },
      createAgent: async () => agent,
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'A' }),
    ).rejects.toMatchObject({ code: 'unmetered-caller' });
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('runtimeSelector: callers outside the journal are refused before the first call', () => {
  it('refuses a provider that can route a request to another model', async () => {
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'decide_next_speaker', args: { action: 'finish' } }] },
    ]);
    const routing = routingProvider(scripted);
    const selector = runtimeSelector({
      reference: { id: 'fixture/selector', version: '1' },
      createAgent: async () =>
        new ConversationAgent({
          name: 'selector',
          aiProviders: [routing],
          defaultModel: { provider: routing.name, model: 'test-model' },
        }),
    });
    const context: SelectionContext = {
      participants: [{ id: 'a', kind: 'agent' }],
      messages: [],
      turns: [],
      remainingTurns: 5,
    };
    await expect(
      selector.select(context, { signal: new AbortController().signal, services: noServices() }),
    ).rejects.toMatchObject({ code: 'unmetered-caller' });
    expect(scripted.requests).toHaveLength(0);
  });
});
