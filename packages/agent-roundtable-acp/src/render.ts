import type { ParticipantTurn } from '@robota-sdk/agent-roundtable';

/**
 * Turns one turn's shared increment into the text of the next `session/prompt`.
 *
 * The result carries only `turn.context.messages`: the core already excludes the participant's own
 * prior output and anything already delivered to it, so a renderer never filters those itself.
 * `firstTurn` decides whether the turn's `purpose` is included; a renderer that never repeats the
 * purpose keeps the agent's private history free of repetition.
 */
export type TurnRenderer = (turn: ParticipantTurn, state: { firstTurn: boolean }) => string;

/**
 * Every line boundary a forged header could hide behind, not just `\n`: a bare `\r`, `\r\n`
 * (matched as one separator so it never produces a spurious blank quoted line), the Unicode line and
 * paragraph separators and NEL that some renderers treat as newlines too, and the two remaining
 * mandatory-break controls, vertical tab and form feed.
 */
// eslint-disable-next-line no-control-regex -- vertical tab and form feed are boundaries this must match, not stray control characters
const LINE_BOUNDARY = /\r\n|[\n\r\u000B\u000C\u2028\u2029\u0085]/;

/** Prefix every line of a message's own content so it can never be read back as a new header. */
export function quoteContent(content: string): string {
  return content
    .split(LINE_BOUNDARY)
    .map((line) => `> ${line}`)
    .join('\n');
}

/** Sent in place of an empty rendered increment, which an agent may reject as an empty prompt. */
const NO_NEW_MESSAGES_NOTICE =
  'There are no new messages since your last turn. Continue or respond as you see fit.';

/**
 * Default {@link TurnRenderer}. Each shared message becomes a `### From <participantId>` header
 * followed by its content, blockquoted line by line, so content that itself contains a line shaped
 * like `### From <id>` is never mistaken for a real header: a forged one is always prefixed by `> `
 * and a real one never is. The turn's `purpose`, when present, is emitted once as a leading line
 * and only on the first turn. A turn with nothing to say renders a neutral notice instead of an
 * empty string.
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
