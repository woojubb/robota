import { SessionSlot } from '@robota-sdk/agent-framework';
import { summarizeUsageBySource } from '@robota-sdk/agent-session-analytics';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IUsageBySourceReport } from '@robota-sdk/agent-session-analytics';
import type { IProtocolSession } from '@robota-sdk/agent-transport';

/**
 * Adapt a live protocol session to the existing per-session usage report. A served runtime binds its
 * transports to a session slot (#3189); the report is about the slot's current session.
 */
export function reportCurrentSessionUsage(session: IProtocolSession): IUsageBySourceReport {
  const target = session instanceof SessionSlot ? (session.current as IProtocolSession) : session;
  const subject = target as IProtocolSession & {
    getFullHistory?: () => IHistoryEntry[];
    getSession?: () => { getSessionId(): string };
  };
  if (!subject.getFullHistory || !subject.getSession) {
    throw new Error('The attached session does not expose usage history.');
  }
  return summarizeUsageBySource({
    id: subject.getSession().getSessionId(),
    history: subject.getFullHistory(),
  });
}
