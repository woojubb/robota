import { summarizeUsageBySource } from '@robota-sdk/agent-session-analytics';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IUsageBySourceReport } from '@robota-sdk/agent-session-analytics';
import type { IProtocolSession } from '@robota-sdk/agent-transport-protocol';

/** Adapt a live protocol session to the existing per-session usage report. */
export function reportCurrentSessionUsage(session: IProtocolSession): IUsageBySourceReport {
  const subject = session as IProtocolSession & {
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
