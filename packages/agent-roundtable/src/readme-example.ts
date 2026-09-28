import {
  createRoundtable,
  externalParticipant,
  MemoryConversationStore,
  type AgentParticipant,
} from './index';

// A participant opens one session per conversation. This one repeats the newest message it sees.
const echo: AgentParticipant = {
  kind: 'agent',
  id: 'echo',
  runtime: { id: 'example/echo', version: '1' },
  factory: {
    openSession: async () => ({
      session: {
        runTurn: async (turn) => {
          const latest = turn.context.messages.at(-1)?.content ?? 'nothing yet';
          return { kind: 'speak', content: `echo: ${latest}` };
        },
      },
      release: async () => {},
    }),
  },
};

export async function runQuickstart() {
  const published: string[] = [];
  const room = createRoundtable({
    conversationId: 'demo',
    participants: [externalParticipant({ id: 'user' }), echo],
    store: new MemoryConversationStore(),
    limits: { maxTurnsPerRun: 1 },
    onEvent: (event) => {
      if (event.type === 'published')
        for (const message of event.messages)
          published.push(`${message.participantId}: ${message.content}`);
    },
  });

  // The default round-robin selector asks the person first, so the run waits for input.
  const waiting = await room.run();
  if (waiting.status === 'waiting') {
    await room.submitInput({
      participantId: 'user',
      inputId: 'input-1', // Retrying with the same id and content returns the same receipt.
      expectedRevision: waiting.revision,
      replyToRequestId: waiting.requests[0].id,
      content: 'Hello',
    });
  }

  const result = await room.run(); // echo speaks: { status: 'limited', reason: 'turns', ... }
  const messages = room.snapshot().messages.map((message) => message.content); // ['Hello', 'echo: Hello']
  await room.dispose();
  return { result, messages, published };
}

await runQuickstart();
