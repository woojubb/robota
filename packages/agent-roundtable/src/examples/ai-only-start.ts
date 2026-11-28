import {
  createRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ParticipantTurn,
} from '../index';

// An AI-only conversation: no `externalParticipant`, so no human turn exists to wait for. The
// conversation's `purpose` is the brief every participant is handed, and the first speaker opens the
// conversation from that alone, before anything has been said.
function scriptedAgent(
  id: string,
  say: (turn: ParticipantTurn) => string,
  seen: string[],
): AgentParticipant {
  return {
    kind: 'agent',
    id,
    runtime: { id: `example/${id}`, version: '1' },
    factory: {
      openSession: async () => ({
        session: {
          runTurn: async (turn) => {
            seen.push(
              `${id} saw ${turn.context.messages.length} message(s), purpose: ${turn.purpose}`,
            );
            return { kind: 'speak', content: say(turn) };
          },
        },
        release: async () => {},
      }),
    },
  };
}

export async function runAiOnlyStart() {
  const seen: string[] = [];
  const planner = scriptedAgent(
    'planner',
    (turn) =>
      turn.context.messages.length === 0
        ? `Proposal for "${turn.purpose}": ship the parser first, then the formatter.`
        : 'Agreed, parser first.',
    seen,
  );
  const critic = scriptedAgent(
    'critic',
    (turn) => `Question: how do we test "${turn.context.messages.at(-1)?.content}"?`,
    seen,
  );

  const room = createRoundtable({
    conversationId: 'ai-only',
    purpose: 'Plan the next release',
    participants: [planner, critic],
    store: new MemoryConversationStore(),
    // The default round-robin selector starts with the first participant listed.
    limits: { maxTurnsPerRun: 3 },
  });

  const result = await room.run(); // { status: 'limited', reason: 'turns', ... }: three turns, no input needed
  const transcript = room.snapshot().messages.map((m) => `${m.participantId}: ${m.content}`);
  await room.dispose();
  return { result, transcript, seen };
}
