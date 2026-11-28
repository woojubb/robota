import { ConversationAgent, type IAIProvider } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import {
  createRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
} from '@robota-sdk/agent-roundtable';
import { runtimeParticipant } from '../index';
// Public import: '@robota-sdk/agent-roundtable-robota/session'.
import { sessionParticipant } from '../session';

// Mixed runtimes: one conversation whose participants run on different runtimes and different
// providers. The roundtable only sees participants and the messages they publish; what stands behind
// each one is its own business. The two providers are scripted stand-ins, so nothing here needs a
// network or a key: a real host passes `new AnthropicProvider(...)`, `new OpenAIProvider(...)` and so
// on in the same places.

/** A scripted model under a provider name of its own, with a count of how often it was called. */
function scriptedProvider(name: string, replies: readonly string[]) {
  const scripted = createScriptedProvider(replies.map((text) => ({ text })));
  const provider: IAIProvider = { ...scripted.provider, name };
  return { provider, calls: () => scripted.requests.length };
}

/** A runtime of neither kind: any object with a `ParticipantFactory` is a participant. */
function wordCounter(): AgentParticipant {
  return {
    kind: 'agent',
    id: 'counter',
    runtime: { id: 'example/word-counter', version: '1' },
    factory: {
      openSession: async () => ({
        session: {
          runTurn: async (turn) => {
            const words = turn.context.messages.flatMap((m) => m.content.split(/\s+/)).length;
            return { kind: 'speak', content: `${words} words so far, no model involved.` };
          },
        },
        release: async () => {},
      }),
    },
  };
}

export async function runMixedRuntimes() {
  const alpha = scriptedProvider('alpha-ai', ['Draft: the cache is cleared on every deploy.']);
  const beta = scriptedProvider('beta-ai', ['Review: clear it lazily instead.']);

  // 1. A plain `ConversationAgent` on the first provider: `runtimeParticipant` wraps an agent the
  //    host builds itself, with the provider listed in `aiProviders`.
  const drafter = runtimeParticipant({
    id: 'drafter',
    runtime: { id: 'example/conversation-agent', version: '1' },
    createAgent: async () =>
      new ConversationAgent({
        name: 'drafter',
        aiProviders: [alpha.provider],
        defaultModel: { provider: alpha.provider.name, model: 'alpha-model' },
      }),
  });

  // 2. A Robota `Session` on the second provider: `sessionParticipant` takes the Session's own
  //    options, whose `provider` and `model` are this participant's alone.
  const reviewer = sessionParticipant({
    id: 'reviewer',
    runtime: { id: 'example/session', version: '1' },
    createSessionOptions: async () => ({
      cwd: process.cwd(),
      hookTypeExecutors: [],
      tools: [],
      provider: beta.provider,
      model: 'beta-model',
      systemMessage: 'You review proposals.',
      autoCompactThreshold: false,
    }),
  });

  const room = createRoundtable({
    conversationId: 'mixed',
    participants: [drafter, reviewer, wordCounter()],
    store: new MemoryConversationStore(),
    limits: { maxTurnsPerRun: 3 },
  });

  const result = await room.run();
  const transcript = room.snapshot().messages.map((m) => `${m.participantId}: ${m.content}`);
  await room.dispose();
  return {
    result,
    transcript,
    // Each provider was called by its own participant only; the third participant called none.
    providerCalls: { 'alpha-ai': alpha.calls(), 'beta-ai': beta.calls() },
  };
}
