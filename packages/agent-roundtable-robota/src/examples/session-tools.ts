import { FunctionTool, type IAIProvider } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import {
  createRoundtable,
  MemoryConversationStore,
  summarizeUsage,
} from '@robota-sdk/agent-roundtable';
// Public import: '@robota-sdk/agent-roundtable-robota/session'.
import { sessionParticipant } from '../session';

// A `sessionParticipant` that uses tools: a free `lookup`, and a paid `charge` that the host must
// approve before it runs. The conversation has a token budget, so every model call and every paid
// effect is admitted against it before it happens. The model is a scripted stand-in (no network, no
// key); a real host passes its provider and the tools it owns.

const usage = { inputTokens: 40, outputTokens: 10 };

/** A scripted provider whose reported usage is attested as complete, as a real adapter marks it. */
function model(): IAIProvider {
  const scripted = createScriptedProvider([
    { toolCalls: [{ name: 'lookup', args: { sku: 'A-1' } }], usage },
    { toolCalls: [{ name: 'charge', args: { sku: 'A-1' } }], usage },
    { text: 'Charged once for A-1.', usage },
  ]);
  return {
    ...scripted.provider,
    chat: async (messages, options) => {
      const reply = await scripted.provider.chat(messages, options);
      return { ...reply, metadata: { ...reply.metadata, usageProvenance: 'complete' } };
    },
  };
}

export async function runSessionTools() {
  const charged: string[] = [];
  const lookup = new FunctionTool(
    {
      name: 'lookup',
      description: 'Looks a product up',
      parameters: { type: 'object', properties: { sku: { type: 'string' } } },
    },
    async (args) => `price of ${String((args as { sku?: unknown }).sku)}: 12`,
  );
  const charge = new FunctionTool(
    {
      name: 'charge',
      description: 'Charges the customer',
      parameters: { type: 'object', properties: { sku: { type: 'string' } } },
    },
    async (args) => {
      charged.push(String((args as { sku?: unknown }).sku)); // The effect a host cannot take back.
      return 'charged';
    },
  );

  const cashier = sessionParticipant({
    id: 'cashier',
    runtime: { id: 'example/cashier', version: '1' },
    // Declares that every call can be bounded before it is dispatched, which a budget requires:
    // each tool is free (no spend of its own) or paid (admitted before it starts). `charge` spends
    // no model tokens of its own, so its token bound is zero.
    enforcement: {
      providerAttempts: 1,
      requestOverheadTokens: 100,
      freeTools: ['lookup'],
      paidTools: { charge: { tokens: 0 } },
    },
    createSessionOptions: async () => ({
      cwd: process.cwd(),
      hookTypeExecutors: [],
      tools: [lookup, charge],
      provider: model(),
      model: 'scripted',
      systemMessage: 'You are a cashier.',
      autoCompactThreshold: false,
      maxOutputTokens: 256,
      // `lookup` runs on its own; `charge` parks a conversation wait the host answers.
      permissions: { allow: ['lookup'], deny: [], ask: ['charge'] },
    }),
  });

  const room = createRoundtable({
    conversationId: 'checkout',
    participants: [cashier],
    store: new MemoryConversationStore(),
    limits: { maxTurnsPerRun: 1 },
    budget: { tokens: 20_000, mode: 'strict' },
  });

  const waiting = await room.run(); // { status: 'waiting', requests: [one approval for `charge`] }
  const chargedWhileWaiting = [...charged]; // Nothing ran past the approval request.
  if (waiting.status !== 'waiting') throw new Error('Expected the turn to wait for approval');
  for (const request of waiting.requests)
    await room.resume({
      requestId: request.id,
      responseId: `host:${request.id}`,
      expectedRevision: room.snapshot().revision,
      response: { kind: 'approval', approved: true },
    });

  const result = await room.run(); // The same turn continues; `charge` runs once.
  const snapshot = room.snapshot();
  await room.dispose();
  return {
    waiting,
    chargedWhileWaiting,
    result,
    charged,
    messages: snapshot.messages.map((message) => message.content),
    // Three model calls and one paid effect, all inside the budget.
    usage: summarizeUsage(snapshot.usage),
  };
}
