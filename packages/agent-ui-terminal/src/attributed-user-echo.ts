import { createUserMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';

import type { IHistoryEntry } from '@robota-sdk/agent-core';

/** The part of a session this needs: who is driving the turn now, if it can say. */
export interface IActiveDriverSource {
  getActiveDriverId?: () => string | null;
}

/**
 * PEER-007 (issue #1915): the transcript echo of a user message, attributed to the ACTIVE turn's
 * driver so a peer's message is labelled as theirs the moment it appears rather than reading as the
 * operator's own for the whole turn. The id is the framework's DERIVED one (`peer:<session-id>`),
 * never peer-supplied text.
 *
 * The lookup is guarded because attribution is an ADDITION to the message, never a precondition for
 * it: a session that cannot say who drove the turn must still get the message on screen. Unguarded,
 * a throw here loses the message entirely and the transcript shows that nothing happened.
 */
export function attributedUserEcho(content: string, session: IActiveDriverSource): IHistoryEntry {
  let driverId: string | null = null;
  try {
    driverId = session.getActiveDriverId?.() ?? null;
  } catch {
    driverId = null;
  }
  return messageToHistoryEntry(
    createUserMessage(content, driverId ? { metadata: { driverId } } : {}),
  );
}
