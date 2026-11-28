import {
  ConversationAgent,
  type IAIProvider,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { createRoundtable, MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import { runtimeParticipant, runtimeSelector } from '../index';

// Selector-driven review: an AI selector, not a fixed order, chooses who speaks next. Here the
// author drafts, the reviewer answers, and the selector sends the draft back to the author until the
// reviewer approves, then finishes the conversation. Every model below is a scripted stand-in, so the
// example needs no network and no key; a real host passes its own providers the same way.

/** The decision a selector model returned, kept so the example can show what steered the review. */
interface Decision {
  action: 'speak' | 'finish';
  participantIds?: string[];
  reason: string;
}

/**
 * Stands in for the selector's model. It answers by calling the decision tool, as a real model
 * does, and reads the shared transcript the selector shows it: it hands the floor to the reviewer
 * after the author, back to the author after a rejection, and finishes on an approval.
 */
function selectorModel(decisions: Decision[]): IAIProvider {
  const decide = (prompt: string): Decision => {
    const said = [...prompt.matchAll(/### From (\w+)\n((?:> .*\n?)+)/g)];
    const last = said.at(-1);
    if (!last)
      return { action: 'speak', participantIds: ['author'], reason: 'Nothing yet: draft.' };
    if (last[1] === 'author')
      return {
        action: 'speak',
        participantIds: ['reviewer'],
        reason: 'A draft is ready to review.',
      };
    if (last[2]!.includes('APPROVED'))
      return { action: 'finish', reason: 'The reviewer approved.' };
    return {
      action: 'speak',
      participantIds: ['author'],
      reason: 'The reviewer asked for changes.',
    };
  };
  return {
    name: 'selector-model',
    version: '1',
    async chat(messages: TUniversalMessage[]) {
      const prompt = String(messages.at(-1)?.content ?? '');
      const decision = decide(prompt);
      decisions.push(decision);
      return {
        id: `decision-${decisions.length}`,
        role: 'assistant' as const,
        content: null,
        state: 'complete' as const,
        timestamp: new Date(),
        toolCalls: [
          {
            id: `decide-${decisions.length}`,
            type: 'function' as const,
            function: { name: 'decide_next_speaker', arguments: JSON.stringify(decision) },
          },
        ],
      };
    },
    async generateResponse() {
      return { content: '' };
    },
    supportsTools: () => true,
    validateConfig: () => true,
  };
}

/** A participant backed by a scripted model that answers with the given texts, one per turn. */
function scriptedParticipant(id: string, replies: readonly string[]) {
  const { provider } = createScriptedProvider(replies.map((text) => ({ text })));
  return runtimeParticipant({
    id,
    runtime: { id: `example/${id}`, version: '1' },
    createAgent: async () =>
      new ConversationAgent({
        name: id,
        aiProviders: [provider],
        defaultModel: { provider: provider.name, model: 'scripted' },
      }),
  });
}

export async function runSelectorReview() {
  const decisions: Decision[] = [];
  const selectorProvider = selectorModel(decisions);
  const selector = runtimeSelector({
    reference: { id: 'example/review-selector', version: '1' },
    createAgent: async () =>
      new ConversationAgent({
        name: 'selector',
        aiProviders: [selectorProvider],
        defaultModel: { provider: selectorProvider.name, model: 'scripted' },
      }),
  });

  const room = createRoundtable({
    conversationId: 'review',
    purpose: 'Write a changelog entry and get it approved',
    participants: [
      scriptedParticipant('author', [
        'Draft 1: Fixed the parser.',
        'Draft 2: Fixed the parser crash on empty input, with a regression test.',
      ]),
      scriptedParticipant('reviewer', [
        'CHANGES REQUESTED: say what was broken and how it is covered.',
        'APPROVED',
      ]),
    ],
    selector,
    store: new MemoryConversationStore(),
    limits: { maxTurnsPerRun: 10 },
  });

  // The selector's own `finish` decision ends the run: { status: 'completed', reason: 'The reviewer approved.' }.
  const result = await room.run();
  const snapshot = room.snapshot();
  await room.dispose();
  return {
    result,
    // Who spoke, in the order the selector chose them.
    speakers: snapshot.turns.map((turn) => turn.participantId),
    transcript: snapshot.messages.map((message) => `${message.participantId}: ${message.content}`),
    decisions,
  };
}
