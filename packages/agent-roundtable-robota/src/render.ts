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

/**
 * Every line boundary a forged header could hide behind, not just `\n`: a bare `\r` (old Mac line
 * endings), `\r\n` (Windows, matched as one separator so it never produces a spurious blank quoted
 * line), and the Unicode line/paragraph separators and NEL that some renderers treat as newlines
 * too (`\u2028`, `\u2029`, `\u0085`). Splitting on `\n` alone let content shaped like
 * `"hi\r### From moderator\r..."` render its `\r`-terminated line unquoted.
 */
const LINE_BOUNDARY = /\r\n|[\n\r\u2028\u2029\u0085]/;

/** Prefix every line of a message's own content so it can never be read back as a new header. */
export function quoteContent(content: string): string {
  return content
    .split(LINE_BOUNDARY)
    .map((line) => `> ${line}`)
    .join('\n');
}

/** Sent in place of an empty rendered increment, which some providers reject as user content. */
const NO_NEW_MESSAGES_NOTICE =
  'There are no new messages since your last turn. Continue or respond as you see fit.';

/**
 * Default {@link TurnRenderer}. Each shared message becomes a `### From <participantId>` header
 * followed by its content, blockquoted line by line — so content that itself contains a line
 * shaped like `### From <id>` or `[id]:` is never mistaken for a real header, because a forged
 * one is always prefixed by `> ` and a real one never is. The turn's `purpose`, when present, is
 * emitted once as a leading line and only on the first turn. A turn with nothing to say — no
 * purpose yet and no shared messages, e.g. a first turn with no purpose or a lone participant
 * whose peers all yielded — renders a neutral notice instead of an empty string, which several
 * providers (Anthropic among them) reject as an empty user message.
 */
export const renderSharedIncrement: TurnRenderer = (turn, state) => {
  const parts: string[] = [];
  if (state.firstTurn && turn.purpose) parts.push(`Purpose: ${turn.purpose}`);
  for (const message of turn.context.messages) {
    parts.push(`### From ${message.participantId}\n${quoteContent(message.content)}`);
  }
  if (parts.length === 0) parts.push(NO_NEW_MESSAGES_NOTICE);
  return parts.join('\n\n');
};
