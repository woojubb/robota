import type { ParticipantTurn } from '@robota-sdk/agent-roundtable';

/**
 * Turns one turn's shared increment into text a Session/Robota run() input can carry.
 *
 * The result carries only `turn.context.messages` — the core already excludes the participant's
 * own prior output and anything already delivered to it (`conversation.ts`), so a renderer never
 * needs to filter those out itself. `firstTurn` decides whether the turn's `purpose` is included;
 * a host renderer that never repeats the purpose keeps the private history free of repetition.
 */
export type TurnRenderer = (turn: ParticipantTurn, state: { firstTurn: boolean }) => string;

/** Prefix every line of a message's own content so it can never be read back as a new header. */
function quoteContent(content: string): string {
  return content
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Default {@link TurnRenderer}. Each shared message becomes a `### From <participantId>` header
 * followed by its content, blockquoted line by line — so content that itself contains a line
 * shaped like `### From <id>` or `[id]:` is never mistaken for a real header, because a forged
 * one is always prefixed by `> ` and a real one never is. The turn's `purpose`, when present, is
 * emitted once as a leading line and only on the first turn.
 */
export const renderSharedIncrement: TurnRenderer = (turn, state) => {
  const parts: string[] = [];
  if (state.firstTurn && turn.purpose) parts.push(`Purpose: ${turn.purpose}`);
  for (const message of turn.context.messages) {
    parts.push(`### From ${message.participantId}\n${quoteContent(message.content)}`);
  }
  return parts.join('\n\n');
};
